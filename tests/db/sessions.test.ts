import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let root: string // superadmin
let mod: string // admin
let ana: string

const call = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => q<T>(db, sql, params)

beforeAll(async () => {
  db = await createDb()
  ;[root, mod, ana] = [await createUser(db, 'Root'), await createUser(db, 'Mod'), await createUser(db, 'Ana')]
  await q(db, `update users set role = 'superadmin' where id = $1`, [root])
  await q(db, `update users set role = 'admin' where id = $1`, [mod])
  await q(db, `insert into guests (name, email, access_code) values ('Ana', 'ana@test.local', 'ANAA1111')`)
  await q(db, `insert into guests (name, email, access_code) values ('Sin Cuenta', 'sincuenta@test.local', 'SINC2222')`)
})
afterAll(async () => {
  await db.close()
})

const info = async (id: string) =>
  (await call<{ out_version: number; out_role: string }>('select * from get_session_info($1)', [id]))[0]

describe('version de sesion', () => {
  it('arranca en 0 y get_session_info devuelve version y rol actuales', async () => {
    expect(await info(ana)).toEqual({ out_version: 0, out_role: 'guest' })
    expect(await info(mod)).toEqual({ out_version: 0, out_role: 'admin' })
    await call(`update users set role = 'admin' where id = $1`, [ana])
    expect((await info(ana)).out_role).toBe('admin') // el rol sale de la base, no del token
    await call(`update users set role = 'guest' where id = $1`, [ana])
  })

  it('un usuario que no existe (o se borro) no tiene sesion', async () => {
    expect(await info('00000000-0000-0000-0000-000000000000')).toBeUndefined()
    const tmp = await createUser(db, 'Tmp')
    expect(await info(tmp)).toBeDefined()
    await call('delete from users where id = $1', [tmp])
    expect(await info(tmp)).toBeUndefined()
  })

  it('revoke_sessions sube la version en 1 cada vez y solo a esa persona', async () => {
    const rev = async (id: string) =>
      (await call<{ out_version: number }>('select * from revoke_sessions($1)', [id]))[0]?.out_version
    expect(await rev(ana)).toBe(1)
    expect(await rev(ana)).toBe(2)
    expect((await info(ana)).out_version).toBe(2)
    expect((await info(mod)).out_version).toBe(0)
    expect(await rev('00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })
})

describe('admin_revoke_sessions', () => {
  const revoke = async (actor: string, guest: string) =>
    (await call<{ out_status: string; out_user: string | null }>('select * from admin_revoke_sessions($1, $2)', [actor, guest]))[0]
  const guestId = async (email: string) =>
    (await call<{ id: string }>('select id from guests where email = $1', [email]))[0].id

  it('un admin cierra las sesiones de un invitado y queda registrado', async () => {
    const before = (await info(ana)).out_version
    const r = await revoke(mod, await guestId('ana@test.local'))
    expect(r).toEqual({ out_status: 'ok', out_user: ana })
    expect((await info(ana)).out_version).toBe(before + 1)

    const log = await call<{ action: string; actor_name: string }>(
      `select * from admin_recent_actions($1) where action = 'sessions_revoke'`,
      [mod]
    )
    expect(log).toHaveLength(1)
    expect(log[0].actor_name).toBe('Mod')
  })

  it('un invitado comun no puede', async () => {
    const before = (await info(mod)).out_version
    const r = await revoke(ana, await guestId('ana@test.local'))
    expect(r).toEqual({ out_status: 'forbidden', out_user: null })
    expect((await info(mod)).out_version).toBe(before)
  })

  it('sin cuenta o inexistente: no hace nada y lo dice', async () => {
    expect((await revoke(mod, await guestId('sincuenta@test.local'))).out_status).toBe('no_account')
    expect((await revoke(mod, '00000000-0000-0000-0000-000000000000')).out_status).toBe('not_found')
  })
})
