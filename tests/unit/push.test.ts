import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPayload, createPushSender, isPushServiceUrl, type PushSubscriptionJson } from '@/lib/push'

const sub = (n: number): PushSubscriptionJson => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: `p${n}`, auth: `a${n}` },
})

describe('isPushServiceUrl', () => {
  it('acepta los servicios de push de los navegadores', () => {
    expect(isPushServiceUrl('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true)
    expect(isPushServiceUrl('https://updates.push.services.mozilla.com/wpush/v2/gAAA')).toBe(true)
    expect(isPushServiceUrl('https://web.push.apple.com/QGx7')).toBe(true)
    expect(isPushServiceUrl('https://wns2-by3p.notify.windows.com/w/?token=x')).toBe(true)
  })

  it('rechaza cualquier otra direccion (el servidor le haria un POST)', () => {
    for (const bad of [
      'https://evil.example.com/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://notify.windows.com.evil.com/x',
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest',
      'no es una url',
    ]) {
      expect(isPushServiceUrl(bad), bad).toBe(false)
    }
  })
})

describe('buildPayload', () => {
  it('acota el titulo y el cuerpo (van a la pantalla bloqueada) y limpia espacios', () => {
    const p = buildPayload({ title: 'x'.repeat(200), body: 'hola\n\n   mundo   '.repeat(30), url: '/matches/1' })
    expect(p.title.length).toBeLessThanOrEqual(60)
    expect(p.title.endsWith('…')).toBe(true)
    expect(p.body.length).toBeLessThanOrEqual(120)
    expect(p.body).not.toMatch(/\n/)
    expect(buildPayload({ title: 'A', body: '  hola   que   tal ', url: '/x' }).body).toBe('hola que tal')
  })

  it('sin titulo usa "Cecify"', () => {
    expect(buildPayload({ title: '   ', body: 'b', url: '/' }).title).toBe('Cecify')
  })

  it('la ruta siempre es interna: una direccion externa se reemplaza por la portada', () => {
    for (const bad of ['https://malo.com', '//malo.com', 'javascript:alert(1)', 'matches/1', '']) {
      expect(buildPayload({ title: 'a', body: 'b', url: bad }).url).toBe('/')
    }
    expect(buildPayload({ title: 'a', body: 'b', url: '/matches/abc?x=1' }).url).toBe('/matches/abc?x=1')
  })

  it('la etiqueta es opcional y se acota', () => {
    expect(buildPayload({ title: 'a', body: 'b', url: '/' })).not.toHaveProperty('tag')
    expect(buildPayload({ title: 'a', body: 'b', url: '/', tag: 't'.repeat(100) }).tag).toHaveLength(64)
  })
})

describe('createPushSender', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  const make = (over: Partial<Parameters<typeof createPushSender>[0]> = {}) => {
    const send = vi.fn().mockResolvedValue(undefined)
    const drop = vi.fn().mockResolvedValue(undefined)
    const list = vi.fn().mockResolvedValue([sub(1), sub(2)])
    return { send, drop, list, run: createPushSender({ configured: true, list, drop, send, ...over }) }
  }

  it('manda a todos los dispositivos de la persona con el mensaje ya acotado', async () => {
    const { run, send, list } = make()
    const r = await run('u1', { title: 'Ana', body: 'hola', url: '/matches/c1', tag: 'chat-c1' })
    expect(r).toEqual({ sent: 2, dropped: 0, failed: 0 })
    expect(list).toHaveBeenCalledWith('u1')
    expect(send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(send.mock.calls[0][1])).toEqual({ title: 'Ana', body: 'hola', url: '/matches/c1', tag: 'chat-c1' })
  })

  it('sin configurar no hace nada (ni consulta la base)', async () => {
    const { run, send, list } = make({ configured: false })
    expect(await run('u1', { title: 'a', body: 'b', url: '/' })).toEqual({ sent: 0, dropped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('un dispositivo dado de baja (404 o 410) se descarta y los demas siguen recibiendo', async () => {
    const { run, send, drop } = make()
    send.mockImplementation(async (s: PushSubscriptionJson) => {
      if (s.endpoint.endsWith('/1')) throw Object.assign(new Error('gone'), { statusCode: 410 })
    })
    const r = await run('u1', { title: 'a', body: 'b', url: '/' })
    expect(r).toEqual({ sent: 1, dropped: 1, failed: 0 })
    expect(drop).toHaveBeenCalledWith('https://push.example.com/send/1')

    send.mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode: 404 }))
    await run('u1', { title: 'a', body: 'b', url: '/' })
    expect(drop).toHaveBeenCalledTimes(2)
  })

  it('otros errores (red, 500, 429) NO borran la suscripcion', async () => {
    const { run, send, drop } = make()
    send.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))
    expect(await run('u1', { title: 'a', body: 'b', url: '/' })).toEqual({ sent: 0, dropped: 0, failed: 2 })
    send.mockRejectedValue(new Error('sin red'))
    expect((await run('u1', { title: 'a', body: 'b', url: '/' })).failed).toBe(2)
    expect(drop).not.toHaveBeenCalled()
  })

  it('nunca lanza: si falla la base, el mensaje o el match que lo origino no se rompe', async () => {
    const { run } = make({ list: vi.fn().mockRejectedValue(new Error('base caida')) })
    await expect(run('u1', { title: 'a', body: 'b', url: '/' })).resolves.toEqual({ sent: 0, dropped: 0, failed: 0 })
    // y si drop falla tampoco
    const m = make({ drop: vi.fn().mockRejectedValue(new Error('x')) })
    m.send.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    await expect(m.run('u1', { title: 'a', body: 'b', url: '/' })).resolves.toMatchObject({ dropped: 2 })
  })

  it('una persona sin dispositivos no manda nada', async () => {
    const { run, send } = make({ list: vi.fn().mockResolvedValue([]) })
    expect(await run('u1', { title: 'a', body: 'b', url: '/' })).toEqual({ sent: 0, dropped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()
  })
})
