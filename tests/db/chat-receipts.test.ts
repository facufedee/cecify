import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mergeMessages, olderCursor } from '@/lib/chat'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let ana: string
let bob: string
let eve: string
let conv: string

beforeAll(async () => {
  db = await createDb()
  ;[ana, bob, eve] = [await createUser(db, 'Ana'), await createUser(db, 'Bob'), await createUser(db, 'Eve')]
  const [lo, hi] = ana < bob ? [ana, bob] : [bob, ana]
  const [m] = await q<{ id: string }>(db, 'insert into matches (user1_id, user2_id) values ($1, $2) returning id', [lo, hi])
  ;[{ id: conv }] = await q<{ id: string }>(
    db,
    'insert into conversations (match_id, user1_id, user2_id) values ($1, $2, $3) returning id',
    [m.id, lo, hi]
  )
})
afterAll(async () => {
  await db.close()
})

const send = async (from: string, to: string, content: string, at?: string) => {
  const [r] = await q<{ id: string }>(
    db,
    `insert into messages (conversation_id, from_user_id, to_user_id, content, created_at)
     values ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW())) returning id`,
    [conv, from, to, content, at ?? null]
  )
  return r.id
}
const markRead = async (user: string) =>
  (await q<{ marked: number; read_up_to: Date | null }>(db, 'select * from mark_read($1, $2)', [user, conv]))[0]
const readState = async (user: string, c = conv) =>
  (await q<{ out_read_up_to: Date | null }>(db, 'select * from chat_read_state($1, $2)', [user, c]))[0]?.out_read_up_to ?? null

describe('mark_read y chat_read_state ("Visto")', () => {
  it('sin lecturas no hay marca', async () => {
    await send(ana, bob, 'hola', '2026-01-01T10:00:00.000Z')
    expect(await readState(ana)).toBeNull()
  })

  it('al leer, devuelve cuantos marco y hasta que mensaje; quien envio ve la marca', async () => {
    await send(ana, bob, 'estas?', '2026-01-01T10:01:00.000Z')
    const r = await markRead(bob)
    expect(r.marked).toBe(2)
    expect(r.read_up_to?.toISOString()).toBe('2026-01-01T10:01:00.000Z')
    expect((await readState(ana))?.toISOString()).toBe('2026-01-01T10:01:00.000Z')
  })

  it('es idempotente: sin nada nuevo no marca ni devuelve fecha', async () => {
    const r = await markRead(bob)
    expect(r).toMatchObject({ marked: 0, read_up_to: null })
  })

  it('un mensaje enviado despues de leer NO figura como visto hasta que se lea', async () => {
    await send(ana, bob, 'nuevo', '2026-01-01T10:05:00.000Z')
    expect((await readState(ana))?.toISOString()).toBe('2026-01-01T10:01:00.000Z')
    const r = await markRead(bob)
    expect(r).toMatchObject({ marked: 1 })
    expect((await readState(ana))?.toISOString()).toBe('2026-01-01T10:05:00.000Z')
  })

  it('leer no cuenta lo propio: lo que envio Bob solo se ve leido cuando Ana lo lee', async () => {
    await send(bob, ana, 'si, aca', '2026-01-01T10:06:00.000Z')
    expect(await readState(bob)).toBeNull()
    expect((await markRead(ana)).read_up_to?.toISOString()).toBe('2026-01-01T10:06:00.000Z')
    expect((await readState(bob))?.toISOString()).toBe('2026-01-01T10:06:00.000Z')
    // y lo de Ana no cambio
    expect((await readState(ana))?.toISOString()).toBe('2026-01-01T10:05:00.000Z')
  })

  it('un extrano no marca nada ni ve el estado de una conversacion ajena', async () => {
    await send(ana, bob, 'privado', '2026-01-01T10:07:00.000Z')
    expect(await markRead(eve)).toMatchObject({ marked: 0, read_up_to: null })
    expect(await readState(eve)).toBeNull()
    expect((await readState(ana))?.toISOString()).toBe('2026-01-01T10:05:00.000Z') // sigue sin leer
  })

  it('los mensajes borrados no cuentan', async () => {
    const id = await send(ana, bob, 'borrado', '2026-01-01T10:08:00.000Z')
    await q(db, 'update messages set deleted_at = NOW() where id = $1', [id])
    expect((await markRead(bob)).read_up_to?.toISOString()).toBe('2026-01-01T10:07:00.000Z')
  })
})

describe('paginar hacia atras', () => {
  // Crea una conversacion de `total` mensajes en la que cada dos caen en el MISMO milisegundo (distintos
  // microsegundos) y la recorre de a paginas de 50 con el cursor del cliente.
  const walk = async (total: number, other: string) => {
    const [lo, hi] = other < bob ? [other, bob] : [bob, other]
    const [{ id: m }] = await q<{ id: string }>(db, 'insert into matches (user1_id, user2_id) values ($1, $2) returning id', [lo, hi])
    const [{ id: c }] = await q<{ id: string }>(
      db,
      'insert into conversations (match_id, user1_id, user2_id) values ($1, $2, $3) returning id',
      [m, lo, hi]
    )

    const base = Date.parse('2026-02-01T12:00:00.000Z')
    const expected: string[] = []
    for (let i = 0; i < total; i++) {
      const ms = base + Math.floor(i / 2) * 1000
      const at = new Date(ms).toISOString().replace('Z', `${i % 2 === 0 ? '100' : '900'}Z`)
      const [r] = await q<{ id: string }>(
        db,
        `insert into messages (conversation_id, from_user_id, to_user_id, content, created_at)
         values ($1, $2, $3, $4, $5::timestamptz) returning id`,
        [c, other, bob, `m${i}`, at]
      )
      expected.push(r.id)
    }

    const page = async (before?: string) =>
      (await q<{ msg_id: string; msg_created_at: Date }>(db, 'select * from get_messages($1, $2, $3, NULL, 50)', [bob, c, before ?? null])).map(
        (r) => ({ id: r.msg_id, fromUserId: other, createdAt: r.msg_created_at.toISOString() })
      )

    let all = await page()
    for (let guard = 0; guard < 10; guard++) {
      const batch = await page(olderCursor(all[0].createdAt))
      all = mergeMessages(all, batch)
      if (batch.length < 50) break
    }
    return { got: all.map((m) => m.id), expected }
  }

  // 130 y 131: el corte de la pagina cae en el primero o en el segundo de un par del mismo milisegundo
  it.each([130, 131, 101])('recorre %i mensajes sin repetir ni saltear ninguno', async (total) => {
    const user = await createUser(db, `Zed${total}`)
    const { got, expected } = await walk(total, user)
    // Ninguno repetido ni perdido. (El orden entre dos mensajes del mismo milisegundo no se exige: el cliente
    // trabaja en milisegundos y el servidor en microsegundos; en un chat real no pasa.)
    expect(new Set(got).size).toBe(got.length)
    expect([...got].sort()).toEqual([...expected].sort())
  })
})
