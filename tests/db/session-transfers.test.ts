import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let ana: string

type Redeemed = { out_user: string; out_role: string; out_version: number; out_session_start: string | number }
const create = (user: string, hash: string, ttl = 900) =>
  q<{ out_expires: string }>(db, 'select * from create_session_transfer($1, $2, $3, $4)', [user, hash, 1_000, ttl])
const redeem = (hash: string) => q<Redeemed>(db, 'select * from redeem_session_transfer($1)', [hash])

beforeAll(async () => {
  db = await createDb()
  ana = await createUser(db, 'Ana')
})
afterAll(async () => {
  await db.close()
})

describe('pasar la sesion a la app instalada', () => {
  it('el codigo se canjea una sola vez, con la misma cuenta y el inicio de sesion original', async () => {
    expect(await create(ana, 'h1')).toHaveLength(1)
    const [r] = await redeem('h1')
    expect(r).toMatchObject({ out_user: ana, out_role: 'guest' })
    expect(Number(r.out_session_start)).toBe(1000)
    expect(await redeem('h1')).toEqual([])
  })

  it('un codigo nuevo anula el anterior (uno activo por persona)', async () => {
    await create(ana, 'h2')
    await create(ana, 'h3')
    expect(await redeem('h2')).toEqual([])
    expect(await redeem('h3')).toHaveLength(1)
  })

  it('vencido no sirve', async () => {
    await create(ana, 'h4')
    await q(db, `update session_transfers set expires_at = now() - interval '1 second' where code_hash = 'h4'`)
    expect(await redeem('h4')).toEqual([])
  })

  it('si la persona cierra sus sesiones despues de pedirlo, el codigo deja de servir', async () => {
    await create(ana, 'h5')
    await q(db, 'select * from revoke_sessions($1)', [ana])
    expect(await redeem('h5')).toEqual([])
  })

  it('un usuario que no existe no genera codigo; uno inventado no se canjea', async () => {
    expect(await create('00000000-0000-0000-0000-000000000000', 'h6')).toEqual([])
    expect(await redeem('inventado')).toEqual([])
  })

  it('la duracion queda entre 1 minuto y 1 hora', async () => {
    const [short] = await create(ana, 'h7', 1)
    const [long] = await create(ana, 'h8', 999_999)
    const [{ now }] = await q<{ now: string }>(db, 'select now()')
    expect(Date.parse(short.out_expires) - Date.parse(now)).toBeGreaterThanOrEqual(59_000)
    expect(Date.parse(long.out_expires) - Date.parse(now)).toBeLessThanOrEqual(3_600_000)
  })
})
