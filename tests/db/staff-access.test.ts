import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

// Un admin no puede quedarse con el acceso de otra cuenta con rol: si viera el codigo de un superadmin
// podria entrar como el (email + codigo) y tener todos sus permisos.
let db: Db
let root: string // superadmin
let mod: string // admin
let gRoot: string
let gMod: string
let gAna: string

const call = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => q<T>(db, sql, params)
const guestId = async (email: string) =>
  (await call<{ id: string }>('select id from guests where email = $1', [email]))[0].id

beforeAll(async () => {
  db = await createDb()
  root = await createUser(db, 'Root')
  mod = await createUser(db, 'Mod')
  await createUser(db, 'Ana')
  await call(`update users set role = 'superadmin' where id = $1`, [root])
  await call(`update users set role = 'admin' where id = $1`, [mod])
  for (const [name, code] of [['Root', 'ROOT1111'], ['Mod', 'MODD2222'], ['Ana', 'ANAA3333']]) {
    await call('insert into guests (name, email, access_code) values ($1, $2, $3)', [name, `${name.toLowerCase()}@test.local`, code])
  }
  ;[gRoot, gMod, gAna] = [await guestId('root@test.local'), await guestId('mod@test.local'), await guestId('ana@test.local')]
})
afterAll(async () => {
  await db.close()
})

const codes = async (actor: string) =>
  Object.fromEntries(
    (await call<{ guest_email: string; guest_code: string | null }>('select * from admin_list_guests($1)', [actor])).map((r) => [
      r.guest_email,
      r.guest_code,
    ])
  )

describe('codigos de las cuentas con rol', () => {
  it('un admin no ve el codigo de un superadmin ni de otro admin; si el de los invitados', async () => {
    expect(await codes(mod)).toEqual({ 'ana@test.local': 'ANAA3333', 'mod@test.local': null, 'root@test.local': null })
  })

  it('un superadmin ve todos', async () => {
    expect(await codes(root)).toEqual({ 'ana@test.local': 'ANAA3333', 'mod@test.local': 'MODD2222', 'root@test.local': 'ROOT1111' })
  })

  it('un admin no puede generarle otro codigo a un superadmin (y el codigo no cambia)', async () => {
    await expect(call(`select * from admin_update_guest($1, $2, NULL, NULL, 'HACK9999')`, [mod, gRoot])).rejects.toThrow(/superadmin/i)
    expect((await codes(root))['root@test.local']).toBe('ROOT1111')
  })

  it('un admin puede editar nombre o lado de un superadmin, pero no recibe su codigo', async () => {
    const [r] = await call<{ out_code: string | null }>(`select * from admin_update_guest($1, $2, 'Root Editado')`, [mod, gRoot])
    expect(r.out_code).toBeNull()
  })

  it('el alta o el CSV no le pisan el codigo a una cuenta con rol ni lo devuelven', async () => {
    const [r] = await call<{ out_code: string | null }>(
      `select * from admin_upsert_guest($1, 'Root', 'root@test.local', 'HACK8888', NULL, true)`,
      [mod]
    )
    expect(r.out_code).toBeNull()
    expect((await codes(root))['root@test.local']).toBe('ROOT1111')
  })

  it('con los invitados comunes un admin sigue pudiendo todo', async () => {
    const [r] = await call<{ out_code: string }>(`select * from admin_update_guest($1, $2, NULL, NULL, 'NUEV4444')`, [mod, gAna])
    expect(r.out_code).toBe('NUEV4444')
    const [u] = await call<{ out_code: string }>(
      `select * from admin_upsert_guest($1, 'Ana', 'ana@test.local', 'OTRA5555', NULL, true)`,
      [mod]
    )
    expect(u.out_code).toBe('OTRA5555')
  })

  it('un superadmin puede cambiarle el codigo a un admin', async () => {
    const [r] = await call<{ out_code: string }>(`select * from admin_update_guest($1, $2, NULL, NULL, 'MODD7777')`, [root, gMod])
    expect(r.out_code).toBe('MODD7777')
  })
})

describe('cerrar sesiones de una cuenta con rol', () => {
  const version = async (id: string) =>
    (await call<{ v: number }>('select session_version as v from users where id = $1', [id]))[0].v

  it('un admin no puede cerrarle las sesiones a un superadmin ni a otro admin', async () => {
    const before = await version(root)
    expect((await call<{ out_status: string }>('select * from admin_revoke_sessions($1, $2)', [mod, gRoot]))[0].out_status).toBe('forbidden')
    expect((await call<{ out_status: string }>('select * from admin_revoke_sessions($1, $2)', [mod, gMod]))[0].out_status).toBe('forbidden')
    expect(await version(root)).toBe(before)
  })

  it('un superadmin si puede', async () => {
    const before = await version(mod)
    expect((await call<{ out_status: string }>('select * from admin_revoke_sessions($1, $2)', [root, gMod]))[0].out_status).toBe('ok')
    expect(await version(mod)).toBe(before + 1)
  })

  it('a un invitado comun lo puede cerrar un admin', async () => {
    expect((await call<{ out_status: string }>('select * from admin_revoke_sessions($1, $2)', [mod, gAna]))[0].out_status).not.toBe('forbidden')
  })
})
