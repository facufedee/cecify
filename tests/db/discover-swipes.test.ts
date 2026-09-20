import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

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

const swipe = async (from: string, to: string, action: 'like' | 'skip') =>
  (await q<{ matched: boolean; match_row_id: string | null; was_duplicate: boolean }>(
    db,
    'select * from record_swipe($1, $2, $3::swipe_action)',
    [from, to, action]
  ))[0]

describe('discover_profiles', () => {
  it('no incluye al propio usuario ni expone contacto ni user_id', async () => {
    const rows = await q<Record<string, unknown>>(db, 'select * from discover_profiles($1)', [a])
    expect(rows.map((r) => r.name).sort()).toEqual(['B', 'C'])
    expect(rows[0]).not.toHaveProperty('contact_methods')
    expect(rows[0]).not.toHaveProperty('user_id')
  })

  it('respeta la lista de exclusion', async () => {
    const [{ id }] = await q<{ id: string }>(db, 'select id from profiles where user_id = $1', [b])
    const rows = await q<{ name: string }>(db, 'select * from discover_profiles($1, 10, $2::uuid[])', [a, [id]])
    expect(rows.map((r) => r.name)).toEqual(['C'])
  })
})

describe('record_swipe', () => {
  it('un like sin reciproco no crea match y oculta al perfil de Descubrir', async () => {
    expect(await swipe(a, b, 'like')).toMatchObject({ matched: false, was_duplicate: false })
    const rows = await q<{ name: string }>(db, 'select * from discover_profiles($1)', [a])
    expect(rows.map((r) => r.name)).toEqual(['C'])
  })

  it('repetir el swipe se marca como duplicado', async () => {
    expect(await swipe(a, b, 'like')).toMatchObject({ matched: false, was_duplicate: true })
  })

  it('like reciproco crea 1 match y 1 conversacion', async () => {
    const r = await swipe(b, a, 'like')
    expect(r.matched).toBe(true)
    expect(r.match_row_id).toBeTruthy()
    expect((await q<{ n: number }>(db, 'select count(*)::int n from matches'))[0].n).toBe(1)
    expect((await q<{ n: number }>(db, 'select count(*)::int n from conversations'))[0].n).toBe(1)
  })

  it('un skip nunca hace match, aunque el otro haya dado like', async () => {
    await swipe(c, a, 'like')
    expect((await swipe(a, c, 'skip')).matched).toBe(false)
  })

  it('un like despues de un skip del otro no hace match', async () => {
    await swipe(b, c, 'skip')
    expect((await swipe(c, b, 'like')).matched).toBe(false)
  })

  it('no se puede swipear a uno mismo', async () => {
    await expect(swipe(a, a, 'like')).rejects.toThrow()
  })
})
