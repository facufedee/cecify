import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let ana: string
let bob: string
let cai: string
let dan: string

const swipe = (from: string, to: string, action: 'like' | 'skip') =>
  q(db, 'select * from record_swipe($1, $2, $3::swipe_action)', [from, to, action])
const sees = async (user: string) =>
  (await q<{ name: string }>(db, 'select * from discover_profiles($1, 20)', [user])).map((r) => r.name).sort()
const skipped = async (user: string) => (await q<{ out_count: number }>(db, 'select * from skipped_count($1)', [user]))[0].out_count

beforeAll(async () => {
  db = await createDb()
  ;[ana, bob, cai, dan] = [await createUser(db, 'Ana'), await createUser(db, 'Bob'), await createUser(db, 'Cai'), await createUser(db, 'Dan')]
})
afterAll(async () => {
  await db.close()
})

describe('volver a ver los que pasaste', () => {
  it('los pasados no aparecen y se cuentan', async () => {
    await swipe(ana, bob, 'skip')
    await swipe(ana, cai, 'skip')
    await swipe(ana, dan, 'like')
    expect(await sees(ana)).toEqual([])
    expect(await skipped(ana)).toBe(2)
  })

  it('no cuenta a quien se oculto, dejo de participar o esta bloqueado', async () => {
    await q(db, 'update profiles set visibility = false where user_id = $1', [cai])
    expect(await skipped(ana)).toBe(1)
    await q(db, 'update profiles set visibility = true where user_id = $1', [cai])
    await q(db, 'insert into blocks (blocker_id, blocked_id) values ($1, $2)', [cai, ana])
    expect(await skipped(ana)).toBe(1)
    await q(db, 'delete from blocks where blocker_id = $1', [cai])
  })

  it('reset_skips los devuelve a Descubrir sin tocar los "me gusta"', async () => {
    const [{ out_count }] = await q<{ out_count: number }>(db, 'select * from reset_skips($1)', [ana])
    expect(out_count).toBe(2)
    expect(await sees(ana)).toEqual(['Bob', 'Cai'])
    expect(await skipped(ana)).toBe(0)
    expect(await q(db, `select 1 from swipes where from_user_id = $1 and to_user_id = $2 and action = 'like'`, [ana, dan])).toHaveLength(1)
  })

  it('solo borra los de esa persona', async () => {
    await swipe(bob, cai, 'skip')
    await q(db, 'select * from reset_skips($1)', [ana])
    expect(await skipped(bob)).toBe(1)
  })

  it('despues de volver a verlos se puede dar me gusta y hacer match', async () => {
    await swipe(bob, ana, 'like')
    const [r] = await q<{ matched: boolean }>(db, 'select * from record_swipe($1, $2, $3::swipe_action)', [ana, bob, 'like'])
    expect(r.matched).toBe(true)
  })
})
