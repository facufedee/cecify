import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, wait, type Db } from '../helpers/db'

let db: Db
let a: string
let b: string
let c: string
let photoA: string
let photoB: string

beforeAll(async () => {
  db = await createDb()
  ;[a, b, c] = [await createUser(db, 'A'), await createUser(db, 'B'), await createUser(db, 'C')]
})
afterAll(async () => {
  await db.close()
})

const createPhoto = async (user: string, caption: string) =>
  (await q<{ new_photo_id: string }>(db, 'select * from create_photo($1, $2, $3)', [user, `/u/${Math.random()}.jpg`, caption]))[0].new_photo_id
const toggle = async (user: string, photo: string) =>
  (await q<{ liked: boolean; total: number; photo_owner: string }>(db, 'select * from toggle_photo_like($1, $2)', [user, photo]))[0]
const feed = (viewer: string) => q<Record<string, any>>(db, 'select * from list_photos(p_user => $1)', [viewer])

describe('publicar', () => {
  it('recorta el epigrafe y guarda vacio como NULL', async () => {
    photoA = await createPhoto(a, '  Mi primera foto  ')
    await wait(15)
    photoB = await createPhoto(b, '')
    const [pa] = await q<{ caption: string | null }>(db, 'select caption from photos where id = $1', [photoA])
    const [pb] = await q<{ caption: string | null }>(db, 'select caption from photos where id = $1', [photoB])
    expect(pa.caption).toBe('Mi primera foto')
    expect(pb.caption).toBeNull()
  })

  it('rechaza epigrafes de mas de 300 caracteres', async () => {
    await expect(createPhoto(a, 'x'.repeat(301))).rejects.toThrow()
  })
})

describe('feed', () => {
  it('la mas nueva primero, con autor, avatar y contadores', async () => {
    const rows = await feed(c)
    expect(rows[0]).toMatchObject({ photo_id: photoB, author_name: 'B', author_photo: '/av-B.jpg', likes_count: 0, liked_by_me: false })
  })

  it('paginacion y filtros', async () => {
    expect(await q(db, 'select * from list_photos(p_user=>$1, p_author=>$2)', [c, a])).toHaveLength(1)
    expect(await q(db, 'select * from list_photos(p_user=>$1, p_photo=>$2)', [c, photoA])).toHaveLength(1)
    const [newest] = await feed(c)
    const older = await q(db, 'select * from list_photos(p_user=>$1, p_before=>$2)', [c, newest.created_at])
    expect(older).toHaveLength(1)
  })
})

describe('me gusta', () => {
  it('alterna, cuenta bien y avisa quien es el dueno', async () => {
    expect(await toggle(b, photoA)).toMatchObject({ liked: true, total: 1, photo_owner: a })
    expect((await toggle(c, photoA)).total).toBe(2)
    expect(await toggle(b, photoA)).toMatchObject({ liked: false, total: 1 })
  })

  it('liked_by_me es solo de quien dio el like', async () => {
    const [forC] = await q<{ liked_by_me: boolean }>(db, 'select * from list_photos(p_user=>$1, p_photo=>$2)', [c, photoA])
    const [forA] = await q<{ liked_by_me: boolean }>(db, 'select * from list_photos(p_user=>$1, p_photo=>$2)', [a, photoA])
    expect(forC.liked_by_me).toBe(true)
    expect(forA.liked_by_me).toBe(false)
  })

  it('una foto inexistente no devuelve filas', async () => {
    const rows = await q(db, 'select * from toggle_photo_like($1, $2)', [b, '00000000-0000-0000-0000-000000000000'])
    expect(rows).toHaveLength(0)
  })

  it('20 me gusta seguidos dan un total exacto', async () => {
    const photo = await createPhoto(a, 'concurrencia')
    const users = await Promise.all(Array.from({ length: 20 }, (_, i) => createUser(db, `U${i}`)))
    await Promise.all(users.map((u) => toggle(u, photo)))
    const [{ likes_count }] = await q<{ likes_count: number }>(db, 'select likes_count from photos where id = $1', [photo])
    expect(likes_count).toBe(20)
  })
})

describe('comentarios', () => {
  it('agrega (recortando), lista en orden con autor y cuenta', async () => {
    await q(db, 'select * from add_comment($1, $2, $3)', [b, photoA, '  Qué linda foto  '])
    await q(db, 'select * from add_comment($1, $2, $3)', [c, photoA, 'Jaja'])
    const list = await q<{ body: string; author_name: string }>(db, 'select * from list_comments($1, $2)', [c, photoA])
    expect(list.map((x) => x.body)).toEqual(['Qué linda foto', 'Jaja'])
    expect(list[0].author_name).toBe('B')
    const [row] = await q<{ comments_count: number }>(db, 'select * from list_photos(p_user=>$1, p_photo=>$2)', [c, photoA])
    expect(row.comments_count).toBe(2)
  })

  it('rechaza vacios, de mas de 300 caracteres y fotos inexistentes', async () => {
    await expect(q(db, 'select * from add_comment($1, $2, $3)', [b, photoA, '   '])).rejects.toThrow()
    await expect(q(db, 'select * from add_comment($1, $2, $3)', [b, photoA, 'x'.repeat(301)])).rejects.toThrow()
    expect(await q(db, 'select * from add_comment($1, $2, $3)', [b, '00000000-0000-0000-0000-000000000000', 'x'])).toHaveLength(0)
  })
})

describe('borrar', () => {
  it('solo el autor puede, y se borran likes y comentarios en cascada', async () => {
    expect(await q(db, 'select * from delete_photo($1, $2)', [b, photoA])).toHaveLength(0)
    expect(await q(db, 'select * from delete_photo($1, $2)', [a, photoA])).toHaveLength(1)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from photo_comments where photo_id = $1', [photoA]))[0].n).toBe(0)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from photo_likes where photo_id = $1', [photoA]))[0].n).toBe(0)
  })
})
