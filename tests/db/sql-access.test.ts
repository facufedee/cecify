import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db

// Igual que callFn en modo local: argumentos con nombre y valores JS tal cual (objetos, arrays), sin serializar a mano
const fn = <T = Record<string, any>>(name: string, args: Record<string, unknown>) => {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return q<T>(db, `select * from ${name}(${named})`, keys.map((k) => args[k]))
}

beforeAll(async () => {
  db = await createDb()
})
afterAll(async () => {
  await db.close()
})

describe('login y cuentas', () => {
  it('find_guest: solo con email y codigo correctos', async () => {
    await q(db, `insert into guests (name, email, access_code) values ('Ana', 'ana@x.com', 'ABCD2345')`)
    expect(await fn('find_guest', { p_email: 'ana@x.com', p_code: 'ABCD2345' })).toHaveLength(1)
    expect(await fn('find_guest', { p_email: 'ana@x.com', p_code: 'ZZZZ2345' })).toHaveLength(0)
    expect(await fn('find_guest', { p_email: 'otra@x.com', p_code: 'ABCD2345' })).toHaveLength(0)
  })

  it('upsert_user: crea la cuenta una vez y no cambia el rol de una existente', async () => {
    const [a] = await fn('upsert_user', { p_email: 'nueva@x.com' })
    expect(a).toMatchObject({ out_email: 'nueva@x.com', out_role: 'guest', out_version: 0 })
    await q(db, `update users set role = 'admin' where id = $1`, [a.out_id])
    const [b] = await fn('upsert_user', { p_email: 'nueva@x.com' })
    expect(b.out_id).toBe(a.out_id)
    expect(b.out_role).toBe('admin')
    expect(await q(db, `select 1 from users where email = 'nueva@x.com'`)).toHaveLength(1)
  })
})

describe('perfil', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    p_name: 'Bea',
    p_age: 31,
    p_bio: 'hola',
    p_main_photo_url: '/uploads/b.jpg',
    p_additional_photos: ['/uploads/1.jpg', '/uploads/2.jpg'],
    p_interests: ['Baile', 'Vino'],
    p_contact_methods: { instagram: 'bea_ig' },
    p_visibility: true,
    p_wants_match: true,
    p_looking_for: ['meet', 'dance'],
    p_side: 'bride',
    ...over,
  })

  it('upsert_profile guarda arrays y objetos pasados como valores JS, y actualiza si ya existe', async () => {
    const [{ out_id }] = await fn('upsert_user', { p_email: 'bea@x.com' })
    const [{ out_profile: p1 }] = await fn('upsert_profile', { p_user: out_id, ...input() })
    expect(p1).toMatchObject({
      user_id: out_id,
      name: 'Bea',
      additional_photos: ['/uploads/1.jpg', '/uploads/2.jpg'],
      interests: ['Baile', 'Vino'],
      contact_methods: { instagram: 'bea_ig' },
      looking_for: ['meet', 'dance'],
      side: 'bride',
    })

    const [{ out_profile: p2 }] = await fn('upsert_profile', {
      p_user: out_id,
      ...input({ p_name: 'Beatriz', p_additional_photos: [], p_looking_for: [], p_wants_match: false, p_side: null }),
    })
    expect(p2).toMatchObject({ id: p1.id, name: 'Beatriz', additional_photos: [], looking_for: [], wants_match: false, side: null })
    expect(await q(db, 'select 1 from profiles where user_id = $1', [out_id])).toHaveLength(1)
  })

  it('upsert_profile respeta las restricciones (modo, lado, que busca)', async () => {
    const [{ out_id }] = await fn('upsert_user', { p_email: 'cai@x.com' })
    await expect(fn('upsert_profile', { p_user: out_id, ...input({ p_side: 'nadie' }) })).rejects.toThrow()
    await expect(fn('upsert_profile', { p_user: out_id, ...input({ p_looking_for: ['otra'] }) })).rejects.toThrow()
  })

  it('get_user_context: rol, datos del invitado, matches y perfil (o NULL sin perfil); sin cuenta no devuelve nada', async () => {
    await q(db, `insert into guests (name, email, access_code, side) values ('Dan', 'dan@x.com', 'DDDD2345', 'groom')`)
    const [{ out_id }] = await fn('upsert_user', { p_email: 'dan@x.com' })
    const [sin] = await fn('get_user_context', { p_user: out_id })
    expect(sin).toMatchObject({ out_email: 'dan@x.com', out_role: 'guest', out_guest_name: 'Dan', out_guest_side: 'groom', out_matches_count: 0, out_profile: null })

    await fn('upsert_profile', { p_user: out_id, ...input({ p_name: 'Dan' }) })
    const other = await createUser(db, 'Eli')
    await q(db, `select * from record_swipe($1, $2, 'like')`, [out_id, other])
    await q(db, `select * from record_swipe($1, $2, 'like')`, [other, out_id])
    const [con] = await fn('get_user_context', { p_user: out_id })
    expect(con.out_matches_count).toBe(1)
    expect(con.out_profile).toMatchObject({ name: 'Dan', user_id: out_id })

    expect(await fn('get_user_context', { p_user: '00000000-0000-0000-0000-000000000000' })).toHaveLength(0)
  })

  it('get_author y get_profile_owner', async () => {
    const id = await createUser(db, 'Fer')
    const [{ id: profile }] = await q<{ id: string }>(db, 'select id from profiles where user_id = $1', [id])
    expect((await fn('get_author', { p_user: id }))[0]).toMatchObject({ out_name: 'Fer', out_photo: '/av-Fer.jpg', out_bio: null })
    expect((await fn('get_profile_owner', { p_profile: profile }))[0]).toMatchObject({ out_user: id, out_name: 'Fer', out_photo: '/av-Fer.jpg' })

    const sinPerfil = (await fn('upsert_user', { p_email: 'sin@x.com' }))[0].out_id
    expect(await fn('get_author', { p_user: sinPerfil })).toHaveLength(0)
    expect(await fn('get_profile_owner', { p_profile: '00000000-0000-0000-0000-000000000000' })).toHaveLength(0)
  })
})

describe('matches y mensajes', () => {
  it('conversation_for_match y unread_total (no cuenta lo leido, lo borrado ni lo de otras personas)', async () => {
    const [a, b, c] = [await createUser(db, 'Ga'), await createUser(db, 'Ha'), await createUser(db, 'Ia')]
    const [, second] = [
      await q(db, `select * from record_swipe($1, $2, 'like')`, [a, b]),
      await q<{ match_row_id: string }>(db, `select * from record_swipe($1, $2, 'like')`, [b, a]),
    ]
    const matchId = second[0].match_row_id
    const [{ out_id: conv }] = await fn('conversation_for_match', { p_match: matchId })
    expect(conv).toBeTruthy()
    expect(await fn('conversation_for_match', { p_match: '00000000-0000-0000-0000-000000000000' })).toHaveLength(0)

    const count = async (u: string) => (await fn('unread_total', { p_user: u }))[0].out_count
    expect(await count(b)).toBe(0)
    await fn('send_message', { p_from: a, p_conversation: conv, p_content: 'uno' })
    await fn('send_message', { p_from: a, p_conversation: conv, p_content: 'dos' })
    await fn('send_message', { p_from: b, p_conversation: conv, p_content: 'respuesta' })
    expect(await count(b)).toBe(2)
    expect(await count(a)).toBe(1)
    expect(await count(c)).toBe(0)

    await q(db, `update messages set deleted_at = now() where content = 'uno'`)
    expect(await count(b)).toBe(1)
    await fn('mark_read', { p_user: b, p_conversation: conv })
    expect(await count(b)).toBe(0)
  })
})
