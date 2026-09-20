import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, wait, type Db } from '../helpers/db'

let db: Db
let a: string
let b: string
let c: string

beforeAll(async () => {
  db = await createDb()
  ;[a, b, c] = [await createUser(db, 'A'), await createUser(db, 'B'), await createUser(db, 'C')]
})
afterAll(async () => {
  await db.close()
})

const createStory = async (user: string, caption: string | null = null) =>
  (await q<{ new_story_id: string }>(db, 'select * from create_story($1, $2, $3)', [user, `/s/${Math.random()}.jpg`, caption]))[0].new_story_id
const view = async (user: string, story: string) =>
  (await q<{ marked: boolean }>(db, 'select * from mark_story_viewed($1, $2)', [user, story]))[0].marked
const rings = (viewer: string) => q<Record<string, any>>(db, 'select * from list_story_rings($1)', [viewer])

let s1: string
let s2: string
let sA: string

describe('crear', () => {
  it('recorta el texto, dura 24 h y rechaza mas de 150 caracteres', async () => {
    s1 = await createStory(b, '  Hola desde la fiesta  ')
    await wait(15)
    s2 = await createStory(b)
    await createStory(c)
    sA = await createStory(a, 'mia')

    const [row] = await q<{ caption: string; ok: boolean }>(
      db,
      `select caption, (expires_at - created_at) between interval '23 hours 59 minutes' and interval '24 hours 1 minute' as ok
         from stories where id = $1`,
      [s1]
    )
    expect(row).toMatchObject({ caption: 'Hola desde la fiesta', ok: true })
    await expect(createStory(a, 'x'.repeat(151))).rejects.toThrow()
  })
})

describe('anillos y lista', () => {
  it('el propio va primero y los demas traen conteo y "sin ver"', async () => {
    const r = await rings(a)
    expect(r[0].author_id).toBe(a)
    expect(r[0].has_unseen).toBe(false)
    expect(r.find((x) => x.author_id === b)).toMatchObject({ stories_count: 2, author_name: 'B', has_unseen: true })
  })

  it('las historias de un autor van de la mas vieja a la mas nueva; el conteo de vistas es solo del autor', async () => {
    const forA = await q<Record<string, any>>(db, 'select * from list_stories($1, $2)', [a, b])
    expect(forA.map((s) => s.story_id)).toEqual([s1, s2])
    expect(forA[0]).toMatchObject({ seen_by_me: false, views_count: null })
    const own = await q<Record<string, any>>(db, 'select * from list_stories($1, $2)', [a, a])
    expect(own[0]).toMatchObject({ seen_by_me: true, views_count: 0 })
  })
})

describe('vistas', () => {
  it('marca una vez (idempotente) y no cuenta la propia ni las inexistentes', async () => {
    expect(await view(a, s1)).toBe(true)
    expect(await view(a, s1)).toBe(false)
    expect(await view(a, sA)).toBe(false)
    expect(await view(a, '00000000-0000-0000-0000-000000000000')).toBe(false)
  })

  it('un autor pasa a "visto" cuando se ven todas sus historias, y baja de orden', async () => {
    expect((await rings(a)).find((x) => x.author_id === b)?.has_unseen).toBe(true)
    await view(a, s2)
    const r = await rings(a)
    expect(r.find((x) => x.author_id === b)?.has_unseen).toBe(false)
    expect(r[1].author_id).toBe(c) // no vistas antes que vistas
    expect(r[2].author_id).toBe(b)
  })

  it('solo el autor ve quien la vio (mas reciente primero)', async () => {
    await view(c, s1)
    const viewers = await q<{ viewer_name: string }>(db, 'select * from list_story_viewers($1, $2)', [b, s1])
    expect(viewers.map((v) => v.viewer_name)).toEqual(['C', 'A'])
    expect(await q(db, 'select * from list_story_viewers($1, $2)', [a, s1])).toHaveLength(0)
    const [own] = await q<{ views_count: number }>(db, 'select * from list_stories($1, $2) order by created_at', [b, b])
    expect(own.views_count).toBe(2)
  })
})

describe('vencimiento y borrado', () => {
  it('una historia vencida desaparece de la lista y de los anillos y no admite vistas', async () => {
    await q(db, `update stories set expires_at = now() - interval '1 minute' where id = $1`, [s1])
    expect(await q(db, 'select * from list_stories($1, $2)', [a, b])).toHaveLength(1)
    expect((await rings(a)).find((x) => x.author_id === b)?.stories_count).toBe(1)
    expect(await view(c, s1)).toBe(false)
  })

  it('crear una historia purga las vencidas hace mas de 2 dias', async () => {
    await q(db, `update stories set expires_at = now() - interval '3 days' where id = $1`, [s1])
    await createStory(a)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from stories where id = $1', [s1]))[0].n).toBe(0)
  })

  it('solo el autor borra, y se borran sus vistas en cascada', async () => {
    expect(await q(db, 'select * from delete_story($1, $2)', [a, s2])).toHaveLength(0)
    expect(await q(db, 'select * from delete_story($1, $2)', [b, s2])).toHaveLength(1)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from story_views where story_id = $1', [s2]))[0].n).toBe(0)
  })
})
