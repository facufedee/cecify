import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8')
const ORIGIN = 'https://cecify.example.com'

type Win = { url: string; visibilityState: string; focused: boolean; focus: () => Promise<void>; navigate?: (u: string) => Promise<void> }

// Ejecuta public/sw.js con un `self` simulado y devuelve lo necesario para dispararle eventos
const loadSw = (opts: { windows?: Win[]; hostname?: string } = {}) => {
  const handlers: Record<string, (e: unknown) => void> = {}
  const self = {
    location: { hostname: opts.hostname ?? 'cecify.example.com', origin: ORIGIN },
    addEventListener: (name: string, fn: (e: unknown) => void) => (handlers[name] = fn),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: {
      matchAll: vi.fn().mockResolvedValue(opts.windows ?? []),
      openWindow: vi.fn().mockResolvedValue(undefined),
      claim: vi.fn(),
    },
  }
  vm.runInNewContext(SOURCE, { self, URL, caches: { open: vi.fn(), keys: vi.fn(), match: vi.fn(), delete: vi.fn() }, fetch: vi.fn() })

  const fire = async (name: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = []
    handlers[name]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
  }
  return { self, fire, handlers }
}

const pushEvent = (data: unknown) => ({ data: { json: () => data } })
const win = (over: Partial<Win> = {}): Win => ({
  url: `${ORIGIN}/matches`,
  visibilityState: 'hidden',
  focused: false,
  focus: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  ...over,
})

describe('sw.js: push', () => {
  it('muestra la notificacion con titulo, cuerpo, etiqueta y la ruta de destino', async () => {
    const { self, fire } = loadSw()
    await fire('push', pushEvent({ title: 'Ana', body: 'hola!', url: '/matches/c1', tag: 'chat-c1' }))
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      'Ana',
      expect.objectContaining({ body: 'hola!', tag: 'chat-c1', renotify: true, data: { url: '/matches/c1' } })
    )
  })

  it('no se muestra si la app esta abierta y a la vista (ya se entero por dentro)', async () => {
    const { self, fire } = loadSw({ windows: [win({ visibilityState: 'visible', focused: true })] })
    await fire('push', pushEvent({ title: 'Ana', body: 'hola', url: '/x' }))
    expect(self.registration.showNotification).not.toHaveBeenCalled()
  })

  it('si la app esta abierta pero en segundo plano, si se muestra', async () => {
    const { self, fire } = loadSw({ windows: [win({ visibilityState: 'hidden' }), win({ visibilityState: 'visible', focused: false })] })
    await fire('push', pushEvent({ title: 'Ana', body: 'hola', url: '/x' }))
    expect(self.registration.showNotification).toHaveBeenCalledTimes(1)
  })

  it('sin etiqueta no pide "renotify" (el navegador lo rechaza) y una direccion externa se reemplaza por "/"', async () => {
    const { self, fire } = loadSw()
    await fire('push', pushEvent({ title: 'X', body: 'y', url: 'https://malo.com/robo' }))
    const [, options] = self.registration.showNotification.mock.calls[0]
    expect(options.renotify).toBe(false)
    expect(options.tag).toBeUndefined()
    expect(options.data.url).toBe('/')
  })

  it('con datos ilegibles o vacios muestra un aviso generico en vez de romperse', async () => {
    const { self, fire } = loadSw()
    await fire('push', { data: { json: () => { throw new Error('no es json') } } })
    await fire('push', { data: null })
    expect(self.registration.showNotification).toHaveBeenCalledTimes(2)
    expect(self.registration.showNotification.mock.calls[0][0]).toBe('Cecify')
  })
})

describe('sw.js: notificationclick', () => {
  const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } })

  it('cierra la notificacion y abre la app en la conversacion si no habia ventana', async () => {
    const { self, fire } = loadSw()
    const e = click('/matches/c1')
    await fire('notificationclick', e)
    expect(e.notification.close).toHaveBeenCalled()
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/matches/c1`)
  })

  it('si ya hay una ventana de la app, la enfoca y la lleva a la conversacion', async () => {
    const w = win()
    const { self, fire } = loadSw({ windows: [w] })
    await fire('notificationclick', click('/matches/c1'))
    expect(w.focus).toHaveBeenCalled()
    expect(w.navigate).toHaveBeenCalledWith(`${ORIGIN}/matches/c1`)
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('ignora ventanas de otros sitios', async () => {
    const other = win({ url: 'https://otro.com/' })
    const { self, fire } = loadSw({ windows: [other] })
    await fire('notificationclick', click('/matches'))
    expect(other.focus).not.toHaveBeenCalled()
    expect(self.clients.openWindow).toHaveBeenCalled()
  })

  it('nunca navega fuera de la app aunque la notificacion traiga otra direccion', async () => {
    const { self, fire } = loadSw()
    await fire('notificationclick', click('https://malo.com'))
    await fire('notificationclick', click('//malo.com'))
    await fire('notificationclick', click(undefined))
    for (const call of self.clients.openWindow.mock.calls) expect(call[0]).toBe(`${ORIGIN}/`)
  })
})

describe('sw.js: cache', () => {
  it('en localhost (desarrollo) no intercepta ningun pedido: no cachea nada', async () => {
    const { handlers } = loadSw({ hostname: 'localhost' })
    const respondWith = vi.fn()
    handlers.fetch({ request: { method: 'GET', url: 'http://localhost/_next/static/x.js', mode: 'no-cors' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('en produccion sigue sin cachear /api ni las paginas (solo la carcasa estatica)', () => {
    const { handlers } = loadSw()
    const respondWith = vi.fn()
    handlers.fetch({ request: { method: 'GET', url: `${ORIGIN}/api/profiles/me`, mode: 'cors' }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })
})
