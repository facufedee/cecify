import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let a: string
let b: string
let c: string
let conv: string

beforeAll(async () => {
  db = await createDb()
  ;[a, b, c] = [await createUser(db, 'A'), await createUser(db, 'B'), await createUser(db, 'C')]
  await q(db, `select * from record_swipe($1, $2, 'like')`, [a, b])
  await q(db, `select * from record_swipe($1, $2, 'like')`, [b, a])
  conv = (await q<{ id: string }>(db, 'select id from conversations'))[0].id
  await q(db, 'select * from send_message($1, $2, $3)', [a, conv, 'hola B'])
})
afterAll(async () => {
  await db.close()
})

const discoverNames = async (u: string) =>
  (await q<{ name: string }>(db, 'select * from discover_profiles($1)', [u])).map((r) => r.name).sort()
const feedAuthors = async (u: string) =>
  (await q<{ author_name: string }>(db, 'select * from list_photos(p_user => $1)', [u])).map((r) => r.author_name).sort()
const block = async (by: string, target: string) =>
  (await q<{ ok: boolean }>(db, 'select * from block_user($1, $2)', [by, target]))[0].ok

describe('blocked_between', () => {
  it('es falso sin bloqueo y verdadero en ambos sentidos con bloqueo', async () => {
    const between = async (x: string, y: string) =>
      (await q<{ is_blocked: boolean }>(db, 'select * from blocked_between($1, $2)', [x, y]))[0].is_blocked
    expect(await between(a, c)).toBe(false)
    await q(db, 'insert into blocks (blocker_id, blocked_id) values ($1, $2)', [c, a])
    expect(await between(a, c)).toBe(true)
    expect(await between(c, a)).toBe(true)
    await q(db, 'delete from blocks where blocker_id = $1 and blocked_id = $2', [c, a])
    expect(await between(a, c)).toBe(false)
  })
})

describe('deshacer match', () => {
  it('un extrano no puede deshacer el match de otros', async () => {
    const rows = await q<{ ok: boolean }>(db, 'select * from unmatch($1, $2)', [c, conv])
    expect(rows[0].ok).toBe(false)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from matches'))[0].n).toBe(1)
  })
})

describe('bloquear', () => {
  it('no se puede bloquear a uno mismo ni a un usuario inexistente', async () => {
    await expect(block(a, a)).rejects.toThrow()
    expect(await block(a, '00000000-0000-0000-0000-000000000000')).toBe(false)
  })

  it('A bloquea a B: se deshace el match y la conversacion, y ambos se ocultan mutuamente', async () => {
    expect(await block(a, b)).toBe(true)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from matches'))[0].n).toBe(0)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from conversations'))[0].n).toBe(0)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from messages'))[0].n).toBe(0)
    expect(await discoverNames(a)).not.toContain('B')
    expect(await discoverNames(b)).not.toContain('A') // tambien en el otro sentido
    expect(await discoverNames(c)).toEqual(expect.arrayContaining(['A', 'B']))
  })

  it('bloquear es idempotente', async () => {
    expect(await block(a, b)).toBe(true)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from blocks'))[0].n).toBe(1)
  })

  it('con bloqueo record_swipe no crea swipes ni match', async () => {
    const [r] = await q<{ matched: boolean; was_duplicate: boolean }>(db, `select * from record_swipe($1, $2, 'like')`, [b, a])
    expect(r).toMatchObject({ matched: false, was_duplicate: true })
  })

  it('el muro, las historias y los comentarios del bloqueado desaparecen (en ambos sentidos)', async () => {
    const photoB = (await q<{ new_photo_id: string }>(db, `select * from create_photo($1, '/b.jpg', 'de B')`, [b]))[0].new_photo_id
    await q(db, `select * from create_photo($1, '/a.jpg', 'de A')`, [a])
    await q(db, `select * from create_photo($1, '/c.jpg', 'de C')`, [c])
    await q(db, 'select * from create_story($1, $2, $3)', [b, '/sb.jpg', null])
    await q(db, 'select * from add_comment($1, $2, $3)', [b, photoB, 'comentario de B'])
    await q(db, 'select * from add_comment($1, $2, $3)', [c, photoB, 'comentario de C'])

    expect(await feedAuthors(a)).toEqual(['A', 'C'])
    expect(await feedAuthors(b)).toEqual(['B', 'C'])
    expect(await feedAuthors(c)).toEqual(['A', 'B', 'C'])
    expect(await q(db, 'select * from list_photos(p_user=>$1, p_author=>$2)', [a, b])).toHaveLength(0)

    expect((await q(db, 'select * from list_story_rings($1)', [a])).map((r: any) => r.author_name)).not.toContain('B')
    expect(await q(db, 'select * from list_stories($1, $2)', [a, b])).toHaveLength(0)
    expect(await q(db, 'select * from list_stories($1, $2)', [c, b])).toHaveLength(1)

    const commentsSeenByA = await q<{ body: string }>(db, 'select * from list_comments($1, $2)', [a, photoB])
    // A bloqueo a B, pero B ya no es visible para A; el comentario de C si
    expect(commentsSeenByA.map((x) => x.body)).toEqual(['comentario de C'])
    const commentsSeenByC = await q<{ body: string }>(db, 'select * from list_comments($1, $2)', [c, photoB])
    expect(commentsSeenByC).toHaveLength(2)
  })

  it('desbloquear devuelve la visibilidad (pero no el match)', async () => {
    const [u] = await q<{ ok: boolean }>(db, 'select * from unblock_user($1, $2)', [a, b])
    expect(u.ok).toBe(true)
    expect((await q<{ ok: boolean }>(db, 'select * from unblock_user($1, $2)', [a, b]))[0].ok).toBe(false)
    expect(await feedAuthors(a)).toContain('B')
    expect((await q<{ n: number }>(db, 'select count(*)::int n from matches'))[0].n).toBe(0)
    // los swipes previos siguen: no reaparecen en Descubrir
    expect(await discoverNames(a)).not.toContain('B')
  })

  it('list_blocked muestra a quienes bloqueaste, con nombre', async () => {
    await block(a, c)
    const rows = await q<{ blocked_name: string }>(db, 'select * from list_blocked($1)', [a])
    expect(rows.map((r) => r.blocked_name)).toEqual(['C'])
    expect(await q(db, 'select * from list_blocked($1)', [c])).toHaveLength(0) // el bloqueado no ve que lo bloquearon
  })
})

describe('deshacer match sin bloquear', () => {
  it('borra match y conversacion, deja los swipes y no bloquea', async () => {
    const [x, y] = [await createUser(db, 'X'), await createUser(db, 'Y')]
    await q(db, `select * from record_swipe($1, $2, 'like')`, [x, y])
    await q(db, `select * from record_swipe($1, $2, 'like')`, [y, x])
    const [{ id }] = await q<{ id: string }>(db, `select c.id from conversations c where c.user1_id in ($1, $2) and c.user2_id in ($1, $2)`, [x, y])
    const [r] = await q<{ ok: boolean }>(db, 'select * from unmatch($1, $2)', [x, id])
    expect(r.ok).toBe(true)
    expect(await q(db, 'select * from conversations where id = $1', [id])).toHaveLength(0)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from swipes where from_user_id in ($1,$2) and to_user_id in ($1,$2)', [x, y]))[0].n).toBe(2)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from blocks where blocker_id = $1', [x]))[0].n).toBe(0)
  })
})

describe('reportes', () => {
  const report = (reporter: string, reported: string, extra: Partial<{ type: string; reason: string; details: string | null }> = {}) =>
    q<{ new_report_id: string }>(
      db,
      `select * from create_report($1, $2, $3::report_type, null, $4::report_reason, $5, $6::jsonb)`,
      [reporter, reported, extra.type ?? 'profile', extra.reason ?? 'spam', extra.details ?? null, JSON.stringify({ nota: 'copia' })]
    )

  it('crea un reporte abierto con la copia del contexto y recorta el detalle', async () => {
    const [{ new_report_id }] = await report(c, a, { details: '  dijo algo feo  ' })
    const [row] = await q<Record<string, any>>(db, 'select * from reports where id = $1', [new_report_id])
    expect(row).toMatchObject({ status: 'open', reason: 'spam', type: 'profile', details: 'dijo algo feo' })
    expect(row.context).toEqual({ nota: 'copia' })
  })

  it('rechaza reportarse a uno mismo, razones o tipos invalidos y detalles largos', async () => {
    await expect(report(a, a)).rejects.toThrow()
    await expect(report(c, a, { reason: 'porque si' })).rejects.toThrow()
    await expect(report(c, a, { type: 'video' })).rejects.toThrow()
    await expect(report(c, a, { details: 'x'.repeat(301) })).rejects.toThrow()
  })

  it('un usuario inexistente no genera reporte', async () => {
    expect(await report(c, '00000000-0000-0000-0000-000000000000')).toHaveLength(0)
  })
})
