import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let ana: string // duena de la foto y de la historia
let bob: string
let cai: string
let photo: string
let story: string

const call = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => q<T>(db, sql, params)

beforeAll(async () => {
  db = await createDb()
  ;[ana, bob, cai] = [await createUser(db, 'Ana'), await createUser(db, 'Bob'), await createUser(db, 'Cai')]
  ;[{ id: photo }] = await call<{ id: string }>(`insert into photos (user_id, photo_url) values ($1, '/a.jpg') returning id`, [ana])
  ;[{ id: story }] = await call<{ id: string }>(`insert into stories (user_id, photo_url) values ($1, '/s.jpg') returning id`, [ana])
})
afterAll(async () => {
  await db.close()
})

const block = (blocker: string, blocked: string) => call('select * from block_user($1, $2)', [blocker, blocked])
const unblock = (blocker: string, blocked: string) => call('select * from unblock_user($1, $2)', [blocker, blocked])

describe('comentarios: aviso al dueno y bloqueos', () => {
  const comment = (user: string, p = photo, text = 'linda foto') =>
    call<{ comment_id: string; photo_owner: string }>('select * from add_comment($1, $2, $3)', [user, p, text])
  const count = async () => (await call<{ n: number }>('select count(*)::int n from photo_comments where photo_id = $1', [photo]))[0].n

  it('devuelve el dueno de la foto (para avisarle)', async () => {
    const [r] = await comment(bob)
    expect(r.photo_owner).toBe(ana)
    expect(await count()).toBe(1)
  })

  it('una foto que no existe no devuelve nada', async () => {
    expect(await comment(bob, '00000000-0000-0000-0000-000000000000')).toHaveLength(0)
  })

  it('con un bloqueo, en cualquiera de los dos sentidos, no se puede comentar (y no se guarda nada)', async () => {
    await block(ana, bob) // Ana bloquea a Bob
    expect(await comment(bob)).toHaveLength(0)
    await unblock(ana, bob)
    await block(bob, ana) // Bob bloquea a Ana
    expect(await comment(bob)).toHaveLength(0)
    expect(await count()).toBe(1)
    await unblock(bob, ana)
  })

  it('al desbloquear se puede volver a comentar, y un tercero no se ve afectado', async () => {
    await block(ana, bob)
    expect(await comment(cai)).toHaveLength(1)
    await unblock(ana, bob)
    expect(await comment(bob)).toHaveLength(1)
  })

  it('comentar tu propia foto funciona (y el dueno es uno mismo: el servidor no se avisa)', async () => {
    const [r] = await comment(ana)
    expect(r.photo_owner).toBe(ana)
  })
})

describe('me gusta: bloqueos', () => {
  const like = (user: string) => call<{ liked: boolean; total: number }>('select * from toggle_photo_like($1, $2)', [user, photo])
  const likes = async () => (await call<{ n: number }>('select likes_count::int n from photos where id = $1', [photo]))[0].n

  it('con un bloqueo no se puede dar me gusta y el contador no cambia', async () => {
    const before = await likes()
    await block(ana, bob)
    expect(await like(bob)).toHaveLength(0)
    expect(await likes()).toBe(before)
    await unblock(ana, bob)
    expect((await like(bob))[0]).toMatchObject({ liked: true })
    expect(await likes()).toBe(before + 1)
  })
})

describe('respuestas a historias', () => {
  const reply = (user: string, s = story, text = 'que linda!') =>
    call<{ out_id: string; out_owner: string }>('select * from add_story_reply($1, $2, $3)', [user, s, text])
  const list = (user: string, s = story) =>
    call<{ from_name: string; content: string }>('select * from list_story_replies($1, $2)', [user, s])

  it('responde y devuelve a quien hay que avisar (la duena de la historia)', async () => {
    const [r] = await reply(bob, story, '  me encanto  ')
    expect(r.out_owner).toBe(ana)
    expect((await list(ana))[0]).toMatchObject({ from_name: 'Bob', content: 'me encanto' })
  })

  it('no se puede responder a la propia historia, a una que no existe ni a una vencida', async () => {
    expect(await reply(ana)).toHaveLength(0)
    expect(await reply(bob, '00000000-0000-0000-0000-000000000000')).toHaveLength(0)
    const [{ id: old }] = await call<{ id: string }>(
      `insert into stories (user_id, photo_url, expires_at) values ($1, '/old.jpg', NOW() - INTERVAL '1 hour') returning id`,
      [ana]
    )
    expect(await reply(bob, old)).toHaveLength(0)
  })

  it('con un bloqueo no se puede responder', async () => {
    await block(ana, cai)
    expect(await reply(cai)).toHaveLength(0)
    await unblock(ana, cai)
    await block(cai, ana)
    expect(await reply(cai)).toHaveLength(0)
    await unblock(cai, ana)
    expect(await reply(cai, story, 'hola')).toHaveLength(1)
  })

  it('el texto tiene que tener entre 1 y 150 caracteres', async () => {
    await expect(reply(bob, story, '   ')).rejects.toThrow()
    await expect(reply(bob, story, 'x'.repeat(151))).rejects.toThrow()
    expect(await reply(bob, story, 'x'.repeat(150))).toHaveLength(1)
  })

  it('solo las ve la duena de la historia: un tercero, e incluso quien respondio, no ven nada', async () => {
    expect((await list(ana)).length).toBeGreaterThan(0)
    expect(await list(bob)).toHaveLength(0) // ni quien escribio
    expect(await list(cai)).toHaveLength(0)
  })

  it('las de alguien que la duena bloqueo dejan de aparecer (y vuelven al desbloquear)', async () => {
    const names = async () => (await list(ana)).map((r) => r.from_name)
    expect(await names()).toContain('Cai')
    await block(ana, cai)
    expect(await names()).not.toContain('Cai')
    await unblock(ana, cai)
    expect(await names()).toContain('Cai')
  })

  it('salen en orden cronologico', async () => {
    const times = (await call<{ created_at: Date }>('select * from list_story_replies($1, $2)', [ana, story])).map((r) => r.created_at.getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('al borrar la historia se borran sus respuestas; al borrar la cuenta, las que escribio', async () => {
    const dan = await createUser(db, 'Dan')
    const [{ id: s2 }] = await call<{ id: string }>(`insert into stories (user_id, photo_url) values ($1, '/s2.jpg') returning id`, [ana])
    await reply(dan, s2, 'de Dan')
    await reply(bob, s2, 'de Bob')
    expect(await list(ana, s2)).toHaveLength(2)

    await call('delete from users where id = $1', [dan])
    expect((await list(ana, s2)).map((r) => r.from_name)).toEqual(['Bob'])

    await call('delete from stories where id = $1', [s2])
    expect(await call('select 1 from story_replies where story_id = $1', [s2])).toHaveLength(0)
  })
})
