import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, createWedding, migratedWedding, q, type Db } from '../helpers/db'

// Dos casamientos en la misma base: A (el migrado, "Cecilia & Lucas") y B (uno nuevo).
// Nadie de A ve ni toca nada de B, y el panel de A solo ve y modera lo de A.

let db: Db
let A: { id: string }
let B: { id: string; owner: string }
// Casamiento A
let ana: string
let ale: string
let ari: string
let rootA: string // superadmin de A
// Casamiento B
let bea: string
let bru: string
let bel: string
let ownerB: string // superadmin de B (el dueño que lo creo)
// Contenido
let phA: string
let phB: string
let stA: string
let stB: string
let convB: string
let convX: string // conversacion vieja entre casamientos (no deberia poder existir; se arma a mano)
let commentB: string
let reportB: string

// Igual que callFn en modo local: argumentos con nombre
const fn = <T = Record<string, any>>(name: string, args: Record<string, unknown>) => {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return q<T>(db, `select * from ${name}(${named})`, keys.map((k) => args[k]))
}
const NONE = '00000000-0000-0000-0000-000000000000'

beforeAll(async () => {
  db = await createDb()
  A = await migratedWedding(db)
  B = await createWedding(db, 'Marta', 'Pedro', 'marta-pedro')
  ownerB = B.owner
  ;[ana, ale, ari, rootA] = [
    await createUser(db, 'Ana', A.id),
    await createUser(db, 'Ale', A.id),
    await createUser(db, 'Ari', A.id),
    await createUser(db, 'Root', A.id),
  ]
  ;[bea, bru, bel] = [await createUser(db, 'Bea', B.id), await createUser(db, 'Bru', B.id), await createUser(db, 'Bel', B.id)]
  await q(db, `update users set role = 'superadmin' where id = $1`, [rootA])

  // La misma persona (mismo email) invitada a los dos casamientos, con otro nombre en cada lista
  await q(db, `insert into guests (wedding_id, name, email, access_code, side) values ($1, 'Ana', 'ana@test.local', 'ANAA1111', 'bride')`, [A.id])
  await q(db, `insert into guests (wedding_id, name, email, access_code, side) values ($1, 'Ana de B', 'ana@test.local', 'ANAB1111', 'groom')`, [B.id])

  // Contenido de cada casamiento, creado por los caminos normales
  ;[{ new_photo_id: phA }] = await fn('create_photo', { p_user: ana, p_url: '/a.jpg', p_caption: 'foto A' })
  ;[{ new_photo_id: phB }] = await fn('create_photo', { p_user: bea, p_url: '/b.jpg', p_caption: 'foto B' })
  ;[{ comment_id: commentB }] = await fn('add_comment', { p_user: bru, p_photo: phB, p_content: 'linda' })
  ;[{ new_story_id: stA }] = await fn('create_story', { p_user: ana, p_url: '/sa.jpg', p_caption: null })
  ;[{ new_story_id: stB }] = await fn('create_story', { p_user: bea, p_url: '/sb.jpg', p_caption: null })
  await fn('mark_story_viewed', { p_user: bru, p_story: stB })
  await fn('add_story_reply', { p_user: bru, p_story: stB, p_content: 'genial' })
  await q(db, `select * from record_swipe($1, $2, 'like')`, [bea, bru])
  const [m] = await q<{ match_row_id: string }>(db, `select * from record_swipe($1, $2, 'like')`, [bru, bea])
  ;[{ out_id: convB }] = await fn('conversation_for_match', { p_match: m.match_row_id })
  await fn('send_message', { p_from: bea, p_conversation: convB, p_content: 'hola Bru' })
  ;[{ new_report_id: reportB }] = await q(
    db,
    `select * from create_report($1, $2, 'profile'::report_type, null, 'spam'::report_reason, null, null)`,
    [bea, bru]
  )

  // Datos viejos entre casamientos, cargados a mano: no tienen que verse ni poder usarse
  const [mx] = await q<{ id: string }>(db, 'insert into matches (user1_id, user2_id) values ($1, $2) returning id', [ana, bea])
  ;[{ id: convX }] = await q<{ id: string }>(
    db,
    'insert into conversations (match_id, user1_id, user2_id) values ($1, $2, $3) returning id',
    [mx.id, ana, bea]
  )
  await q(db, `insert into messages (conversation_id, from_user_id, to_user_id, content) values ($1, $2, $3, 'de B sin leer')`, [convX, bea, ana])
  await q(db, `insert into messages (conversation_id, from_user_id, to_user_id, content, is_read) values ($1, $2, $3, 'leido en B', true)`, [convX, ana, bea])
  await q(db, 'insert into blocks (blocker_id, blocked_id) values ($1, $2)', [ana, bea])
  await q(db, `insert into swipes (from_user_id, to_user_id, action) values ($1, $2, 'skip')`, [ana, bru])
  await q(db, 'insert into story_views (story_id, viewer_id) values ($1, $2)', [stB, ale])
  await q(db, `insert into story_replies (story_id, from_user_id, content) values ($1, $2, 'de A')`, [stB, ale])
})
afterAll(async () => {
  await db.close()
})

describe('aislamiento por casamiento: lo que cada persona ve', () => {
  it('discover_profiles solo muestra gente del mismo casamiento', async () => {
    const names = (await fn<{ name: string }>('discover_profiles', { p_user: ana, p_limit: 20 })).map((r) => r.name).sort()
    expect(names).toEqual(['Ale', 'Ari', 'Root'])
    const deB = (await fn<{ name: string }>('discover_profiles', { p_user: bru, p_limit: 20 })).map((r) => r.name).sort()
    expect(deB).toEqual(['Bel'])
  })

  it('list_photos: el muro, una foto suelta y el muro de una persona de otro casamiento', async () => {
    expect((await fn('list_photos', { p_user: ana })).map((r) => r.photo_id)).toEqual([phA])
    expect(await fn('list_photos', { p_user: ana, p_photo: phB })).toEqual([])
    expect(await fn('list_photos', { p_user: ale, p_author: bea })).toEqual([])
    expect((await fn('list_photos', { p_user: bru })).map((r) => r.photo_id)).toEqual([phB])
  })

  it('list_comments no muestra los comentarios de una foto de otro casamiento', async () => {
    expect(await fn('list_comments', { p_viewer: ana, p_photo: phB })).toEqual([])
    expect((await fn('list_comments', { p_viewer: bea, p_photo: phB })).map((r) => r.comment_id)).toEqual([commentB])
  })

  it('historias: anillos, historias de una persona, quien las vio y respuestas', async () => {
    expect((await fn('list_story_rings', { p_user: ale })).map((r) => r.author_id)).toEqual([ana])
    expect((await fn('list_story_rings', { p_user: bru })).map((r) => r.author_id)).toEqual([bea])
    expect(await fn('list_stories', { p_user: ale, p_author: bea })).toEqual([])
    expect(await fn('list_stories', { p_user: bru, p_author: bea })).toHaveLength(1)
    // La vista y la respuesta vieja de Ale (de A) no le aparecen a Bea
    expect((await fn('list_story_viewers', { p_user: bea, p_story: stB })).map((r) => r.viewer_id)).toEqual([bru])
    expect((await fn('list_story_replies', { p_user: bea, p_story: stB })).map((r) => r.from_id)).toEqual([bru])
  })

  it('chat: conversaciones, mensajes, no leidos y "Visto" con alguien de otro casamiento no aparecen', async () => {
    expect(await fn('list_conversations', { p_user: ana })).toEqual([])
    expect((await fn('list_conversations', { p_user: bea })).map((r) => r.conversation_id)).toEqual([convB])
    expect(await fn('get_messages', { p_user: ana, p_conversation: convX })).toEqual([])
    expect(await fn('unread_total', { p_user: ana })).toEqual([{ out_count: 0 }])
    expect(await fn('chat_read_state', { p_user: ana, p_conversation: convX })).toEqual([{ out_read_up_to: null }])
    expect(await fn('unread_total', { p_user: bru })).toEqual([{ out_count: 1 }])
  })

  it('pasados, bloqueados y datos de una persona de otro casamiento', async () => {
    expect(await fn('skipped_count', { p_user: ana })).toEqual([{ out_count: 0 }])
    expect(await fn('list_blocked', { p_user: ana })).toEqual([])
    expect(await fn('get_author', { p_user: bea, p_viewer: ana })).toEqual([])
    expect(await fn('get_author', { p_user: ale, p_viewer: ana })).toHaveLength(1)
    const [{ id: profBea }] = await q<{ id: string }>(db, 'select id from profiles where user_id = $1', [bea])
    expect(await fn('get_profile_owner', { p_profile: profBea, p_viewer: ana })).toEqual([])
    expect(await fn('get_profile_owner', { p_profile: profBea, p_viewer: bru })).toEqual([
      { out_user: bea, out_name: 'Bea', out_photo: '/av-Bea.jpg' },
    ])
  })

  it('get_user_context toma los datos de la lista de su propio casamiento', async () => {
    const rows = await fn('get_user_context', { p_user: ana })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ out_guest_name: 'Ana', out_guest_side: 'bride' })
  })
})

describe('aislamiento por casamiento: el panel', () => {
  it('admin_stats cuenta solo lo de su casamiento', async () => {
    const [a] = await fn('admin_stats', { p_actor: rootA })
    expect(a).toMatchObject({
      guests_total: 1,
      profiles_total: 4,
      photos_total: 1,
      comments_total: 0,
      stories_active: 1,
      reports_open: 0,
      matches_total: 0,
      messages_total: 0,
    })
    const [b] = await fn('admin_stats', { p_actor: ownerB })
    expect(b).toMatchObject({
      guests_total: 1,
      profiles_total: 3,
      photos_total: 1,
      comments_total: 1,
      stories_active: 1,
      reports_open: 1,
      matches_total: 1,
      messages_total: 1,
    })
  })

  it('reportes: el panel de A no ve ni resuelve los de B', async () => {
    expect(await fn('admin_list_reports', { p_actor: rootA })).toEqual([])
    expect((await fn('admin_list_reports', { p_actor: ownerB })).map((r) => r.report_id)).toEqual([reportB])
    expect(await fn('admin_set_report_status', { p_actor: rootA, p_report: reportB, p_status: 'reviewed' })).toEqual([{ out_ok: false }])
    expect((await q(db, 'select status::text from reports where id = $1', [reportB]))[0]).toEqual({ status: 'open' })
    expect(await fn('admin_set_report_status', { p_actor: ownerB, p_report: reportB, p_status: 'reviewed' })).toEqual([{ out_ok: true }])
  })

  it('moderacion: el panel de A no lista ni borra fotos, comentarios ni historias de B', async () => {
    expect((await fn('admin_list_photos', { p_actor: rootA })).map((r) => r.photo_id)).toEqual([phA])
    expect(await fn('admin_list_comments', { p_actor: rootA, p_photo: phB })).toEqual([])
    expect((await fn('admin_list_stories', { p_actor: rootA })).map((r) => r.story_id)).toEqual([stA])
    expect(await fn('admin_delete_photo', { p_actor: rootA, p_photo: phB })).toEqual([])
    expect(await fn('admin_delete_comment', { p_actor: rootA, p_comment: commentB })).toEqual([])
    expect(await fn('admin_delete_story', { p_actor: rootA, p_story: stB })).toEqual([])
    expect(await q(db, 'select 1 from photos where id = $1', [phB])).toHaveLength(1)
    expect(await q(db, 'select 1 from photo_comments where id = $1', [commentB])).toHaveLength(1)
    expect(await q(db, 'select 1 from stories where id = $1', [stB])).toHaveLength(1)
    expect((await fn('admin_list_comments', { p_actor: ownerB, p_photo: phB })).map((r) => r.comment_id)).toEqual([commentB])
  })

  it('roles: un superadmin no cambia a gente de otro casamiento y cada casamiento conserva su superadmin', async () => {
    expect(await fn('set_user_role', { p_actor: rootA, p_target: bea, p_role: 'admin' })).toEqual([{ status: 'not_found', new_role: null }])
    expect(await fn('set_user_role', { p_actor: ownerB, p_target: ana, p_role: 'admin' })).toEqual([{ status: 'not_found', new_role: null }])
    expect((await q(db, 'select role::text from users where id = $1', [bea]))[0]).toEqual({ role: 'guest' })
    // Hay otro superadmin (rootA), pero es de otro casamiento: B no puede quedarse sin el suyo
    expect((await fn('set_user_role', { p_actor: ownerB, p_target: ownerB, p_role: 'guest' }))[0].status).toBe('last_superadmin')
    expect((await fn('set_user_role', { p_actor: rootA, p_target: ale, p_role: 'admin' }))[0].status).toBe('ok')
  })

  it('admin_recent_actions solo muestra lo que paso en su casamiento', async () => {
    const deA = await fn('admin_recent_actions', { p_actor: rootA })
    expect(deA.map((r) => r.action)).toContain('set_role')
    expect(deA.map((r) => r.action)).not.toContain('report_reviewed')
    const deB = await fn('admin_recent_actions', { p_actor: ownerB })
    expect(deB.map((r) => r.action)).toContain('report_reviewed')
    expect(deB.map((r) => r.action)).not.toContain('set_role')
  })
})

describe('aislamiento por casamiento: acciones entre personas', () => {
  it('record_swipe no registra nada ni hace match con alguien de otro casamiento', async () => {
    expect((await q(db, `select * from record_swipe($1, $2, 'like')`, [ana, bel]))[0]).toMatchObject({ matched: false, was_duplicate: true })
    expect((await q(db, `select * from record_swipe($1, $2, 'like')`, [bel, ana]))[0]).toMatchObject({ matched: false, was_duplicate: true })
    expect(await q(db, 'select 1 from swipes where (from_user_id, to_user_id) in (($1, $2), ($2, $1))', [ana, bel])).toEqual([])
  })

  it('chat con alguien de otro casamiento: no se escribe, no se marca leido, no se deshace', async () => {
    expect(await fn('send_message', { p_from: ana, p_conversation: convX, p_content: 'hola' })).toEqual([])
    expect(await fn('mark_read', { p_user: ana, p_conversation: convX })).toEqual([{ marked: 0, read_up_to: null }])
    expect(await fn('unmatch', { p_user: ana, p_conversation: convX })).toEqual([{ ok: false }])
    expect(await q(db, 'select 1 from conversations where id = $1', [convX])).toHaveLength(1)
  })

  it('muro e historias de otro casamiento: sin me gusta, comentarios, respuestas ni vistas', async () => {
    expect(await fn('toggle_photo_like', { p_user: ana, p_photo: phB })).toEqual([])
    expect(await fn('add_comment', { p_user: ana, p_photo: phB, p_content: 'hola' })).toEqual([])
    expect(await fn('add_story_reply', { p_user: ana, p_story: stB, p_content: 'hola' })).toEqual([])
    expect(await fn('mark_story_viewed', { p_user: ana, p_story: stB })).toEqual([{ marked: false }])
    expect(await q(db, 'select 1 from photo_likes where photo_id = $1', [phB])).toEqual([])
  })

  it('bloquear, desbloquear y reportar solo dentro del casamiento', async () => {
    expect(await fn('block_user', { p_blocker: ana, p_blocked: bru })).toEqual([{ ok: false }])
    expect(await q(db, 'select 1 from blocks where blocker_id = $1 and blocked_id = $2', [ana, bru])).toEqual([])
    expect(await fn('unblock_user', { p_blocker: ana, p_blocked: bea })).toEqual([{ ok: false }])
    expect(
      await q(db, `select * from create_report($1, $2, 'profile'::report_type, null, 'spam'::report_reason, null, null)`, [ana, bea])
    ).toEqual([])
  })

  it('dentro del mismo casamiento todo sigue andando', async () => {
    expect((await fn('toggle_photo_like', { p_user: bru, p_photo: phB }))[0]).toMatchObject({ liked: true, total: 1 })
    expect(await fn('add_comment', { p_user: ale, p_photo: phA, p_content: 'buena' })).toHaveLength(1)
    expect(await fn('mark_story_viewed', { p_user: ale, p_story: stA })).toEqual([{ marked: true }])
    expect(await fn('add_story_reply', { p_user: ale, p_story: stA, p_content: 'linda' })).toHaveLength(1)
    expect(await fn('block_user', { p_blocker: ana, p_blocked: ari })).toEqual([{ ok: true }])
    expect(await fn('unblock_user', { p_blocker: ana, p_blocked: ari })).toEqual([{ ok: true }])
    expect(
      await q(db, `select * from create_report($1, $2, 'profile'::report_type, null, 'spam'::report_reason, null, null)`, [ana, ari])
    ).toHaveLength(1)

    await q(db, `select * from record_swipe($1, $2, 'like')`, [ana, ale])
    const [m] = await q<{ matched: boolean; match_row_id: string }>(db, `select * from record_swipe($1, $2, 'like')`, [ale, ana])
    expect(m.matched).toBe(true)
    const [{ out_id: conv }] = await fn('conversation_for_match', { p_match: m.match_row_id })
    expect(await fn('send_message', { p_from: ana, p_conversation: conv, p_content: 'hola Ale' })).toHaveLength(1)
    expect(await fn('mark_read', { p_user: ale, p_conversation: conv })).toMatchObject([{ marked: 1 }])
    expect((await fn('list_conversations', { p_user: ana })).map((r) => r.conversation_id)).toEqual([conv])
    expect(await fn('unmatch', { p_user: ana, p_conversation: conv })).toEqual([{ ok: true }])

    // El panel de B modera lo suyo
    expect(await fn('admin_delete_photo', { p_actor: ownerB, p_photo: phB })).toEqual([{ out_url: '/b.jpg' }])
  })
})
