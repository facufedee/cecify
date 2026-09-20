import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, wait, type Db } from '../helpers/db'

let db: Db
let a: string
let b: string
let stranger: string
let conv: string

beforeAll(async () => {
  db = await createDb()
  ;[a, b, stranger] = [await createUser(db, 'A'), await createUser(db, 'B'), await createUser(db, 'X')]
  await q(db, `select * from record_swipe($1, $2, 'like')`, [a, b])
  await q(db, `select * from record_swipe($1, $2, 'like')`, [b, a])
  conv = (await q<{ id: string }>(db, 'select id from conversations'))[0].id
})
afterAll(async () => {
  await db.close()
})

const send = (from: string, content: string, conversation = conv) =>
  q<{ msg_to: string; msg_content: string }>(db, 'select * from send_message($1, $2, $3)', [from, conversation, content])

describe('list_conversations', () => {
  it('trae al otro con su contacto (ya hay match) y sin mensajes al principio', async () => {
    const [row] = await q<Record<string, any>>(db, 'select * from list_conversations($1)', [a])
    expect(row).toMatchObject({ other_name: 'B', last_content: null, unread_count: 0 })
    expect(row.other_contact.instagram).toBe('ig_B')
  })

  it('un extrano no ve conversaciones ajenas', async () => {
    expect(await q(db, 'select * from list_conversations($1)', [stranger])).toHaveLength(0)
  })
})

describe('send_message', () => {
  it('guarda el mensaje y devuelve al destinatario', async () => {
    const [m] = await send(a, 'hola')
    expect(m).toMatchObject({ msg_to: b, msg_content: 'hola' })
  })

  it('un extrano no puede escribir en una conversacion ajena', async () => {
    expect(await send(stranger, 'intruso')).toHaveLength(0)
  })

  it('rechaza mensajes vacios o de mas de 1000 caracteres', async () => {
    await expect(send(a, '')).rejects.toThrow()
    await expect(send(a, 'x'.repeat(1001))).rejects.toThrow()
  })

  it('el destinatario ve 1 no leido y la vista previa; el remitente 0', async () => {
    const [forB] = await q<Record<string, any>>(db, 'select * from list_conversations($1)', [b])
    expect(forB).toMatchObject({ unread_count: 1, last_content: 'hola', last_from: a })
    const [forA] = await q<Record<string, any>>(db, 'select * from list_conversations($1)', [a])
    expect(forA.unread_count).toBe(0)
  })
})

describe('get_messages y mark_read', () => {
  it('un extrano no puede leer los mensajes', async () => {
    expect(await q(db, 'select * from get_messages($1, $2)', [stranger, conv])).toHaveLength(0)
  })

  it('devuelve los mensajes en orden y `after` solo los nuevos', async () => {
    await wait(20)
    await send(b, 'chau')
    const all = await q<{ msg_content: string; msg_created_at: Date }>(db, 'select * from get_messages($1, $2)', [a, conv])
    expect(all.map((m) => m.msg_content)).toEqual(['hola', 'chau'])
    const fresh = await q<{ msg_content: string }>(
      db,
      'select * from get_messages(p_user => $1, p_conversation => $2, p_after => $3)',
      [a, conv, all[0].msg_created_at]
    )
    expect(fresh.map((m) => m.msg_content)).toEqual(['chau'])
  })

  it('mark_read marca una vez, es idempotente y un extrano no marca nada', async () => {
    const marked = async (u: string) => (await q<{ marked: number }>(db, 'select * from mark_read($1, $2)', [u, conv]))[0].marked
    expect(await marked(b)).toBe(1)
    expect(await marked(b)).toBe(0)
    expect(await marked(stranger)).toBe(0)
  })
})
