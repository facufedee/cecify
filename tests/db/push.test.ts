import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let ana: string
let bob: string

beforeAll(async () => {
  db = await createDb()
  ;[ana, bob] = [await createUser(db, 'Ana'), await createUser(db, 'Bob')]
})
afterAll(async () => {
  await db.close()
})

const sub = (n: number | string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` }, ...over })

const save = (user: string, s: string, ua: string | null = 'Firefox') =>
  q<{ out_id: string }>(db, 'select * from save_push_subscription($1, $2::jsonb, $3)', [user, s, ua])
const list = async (user: string) =>
  (await q<{ out_subscription: { endpoint: string } }>(db, 'select * from list_push_subscriptions($1)', [user])).map((r) => r.out_subscription.endpoint)

describe('suscripciones push', () => {
  it('guarda un dispositivo, lo lista y no duplica al re-suscribir el mismo', async () => {
    await save(ana, sub(1))
    await save(ana, sub(1))
    expect(await list(ana)).toEqual(['https://push.example.com/send/1'])
    expect(await q(db, 'select 1 from push_subscriptions where user_id = $1', [ana])).toHaveLength(1)
  })

  it('cada persona ve solo sus dispositivos', async () => {
    await save(bob, sub('b1'))
    expect(await list(bob)).toEqual(['https://push.example.com/send/b1'])
    expect(await list(ana)).not.toContain('https://push.example.com/send/b1')
  })

  it('si otra persona inicia sesion en el mismo dispositivo, la suscripcion pasa a ser suya', async () => {
    await save(ana, sub('shared'))
    expect(await list(ana)).toContain('https://push.example.com/send/shared')
    await save(bob, sub('shared'))
    expect(await list(ana)).not.toContain('https://push.example.com/send/shared')
    expect(await list(bob)).toContain('https://push.example.com/send/shared')
  })

  it('rechaza suscripciones con forma invalida', async () => {
    await expect(save(ana, JSON.stringify({ endpoint: 'http://inseguro.com/x', keys: { p256dh: 'p', auth: 'a' } }))).rejects.toThrow()
    await expect(save(ana, JSON.stringify({ endpoint: 'https://ok.com/x', keys: { p256dh: 'p' } }))).rejects.toThrow()
    await expect(save(ana, JSON.stringify({ keys: { p256dh: 'p', auth: 'a' } }))).rejects.toThrow()
    await expect(save(ana, JSON.stringify({ endpoint: 'https://ok.com/' + 'x'.repeat(2100), keys: { p256dh: 'p', auth: 'a' } }))).rejects.toThrow()
  })

  it('maximo 10 dispositivos por persona: se descartan los mas viejos', async () => {
    const eve = await createUser(db, 'Eve')
    for (let i = 0; i < 12; i++) {
      await save(eve, sub(`e${i}`))
      // los anteriores quedan cada vez mas en el pasado: el ultimo guardado siempre es el mas nuevo
      await q(db, `update push_subscriptions set created_at = NOW() - ($2 || ' seconds')::interval where endpoint = $1`, [
        `https://push.example.com/send/e${i}`,
        String(20 - i),
      ])
    }
    const mine = await list(eve)
    expect(mine).toHaveLength(10)
    expect(mine).not.toContain('https://push.example.com/send/e0')
    expect(mine).toContain('https://push.example.com/send/e11')
  })

  it('dar de baja un dispositivo: solo el dueño puede', async () => {
    const del = async (user: string, endpoint: string) =>
      (await q<{ out_ok: boolean }>(db, 'select * from delete_push_subscription($1, $2)', [user, endpoint]))[0].out_ok
    const ep = 'https://push.example.com/send/b1'
    expect(await del(ana, ep)).toBe(false) // ajeno
    expect(await list(bob)).toContain(ep)
    expect(await del(bob, ep)).toBe(true)
    expect(await list(bob)).not.toContain(ep)
    expect(await del(bob, ep)).toBe(false) // ya no estaba
  })

  it('borrar todos los dispositivos de una persona no toca los de otra', async () => {
    await save(ana, sub('a2'))
    const [{ out_count }] = await q<{ out_count: number }>(db, 'select * from delete_push_subscriptions($1)', [ana])
    expect(out_count).toBeGreaterThanOrEqual(2)
    expect(await list(ana)).toEqual([])
    expect((await list(bob)).length).toBeGreaterThan(0)
  })

  it('drop_push_endpoint quita un dispositivo sea de quien sea (lo usa el servidor cuando el servicio dice 410)', async () => {
    await save(bob, sub('gone'))
    const [{ out_count }] = await q<{ out_count: number }>(db, 'select * from drop_push_endpoint($1)', ['https://push.example.com/send/gone'])
    expect(out_count).toBe(1)
    expect(await list(bob)).not.toContain('https://push.example.com/send/gone')
  })

  it('al borrar la cuenta se borran sus dispositivos', async () => {
    const tmp = await createUser(db, 'Tmp')
    await save(tmp, sub('tmp1'))
    await q(db, 'delete from users where id = $1', [tmp])
    expect(await q(db, `select 1 from push_subscriptions where endpoint = 'https://push.example.com/send/tmp1'`)).toHaveLength(0)
  })
})
