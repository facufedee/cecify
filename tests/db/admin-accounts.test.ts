import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, q, type Db } from '../helpers/db'

let db: Db
beforeAll(async () => {
  db = await createDb()
})
afterAll(async () => {
  await db.close()
})

const login = async (u: string) =>
  (await q<{ out_user: string; out_hash: string; out_role: string; out_version: number }>(db, 'select * from admin_account_for_login($1)', [u]))[0]

describe('cuentas de organizador', () => {
  it('create_admin_account crea un superadmin con email interno que no esta en la lista de invitados', async () => {
    const [r] = await q<{ out_user: string; out_created: boolean }>(db, `select * from create_admin_account(' FacuFede ', 'scrypt$hash1')`)
    expect(r.out_created).toBe(true)
    const [u] = await q<{ email: string; role: string }>(db, 'select email, role from users where id = $1', [r.out_user])
    expect(u).toEqual({ email: 'facufede@admin.invalid', role: 'superadmin' })
    expect(await q(db, `select 1 from guests where email = 'facufede@admin.invalid'`)).toEqual([])
    expect(await login('FACUFEDE')).toMatchObject({ out_user: r.out_user, out_hash: 'scrypt$hash1', out_role: 'superadmin' })
  })

  it('volver a crearla cambia la contraseña, le devuelve el rol y cierra sus sesiones', async () => {
    const before = await login('facufede')
    await q(db, `update users set role = 'guest' where id = $1`, [before.out_user])
    const [r] = await q<{ out_created: boolean }>(db, `select * from create_admin_account('facufede', 'scrypt$hash2')`)
    expect(r.out_created).toBe(false)
    expect(await login('facufede')).toMatchObject({ out_hash: 'scrypt$hash2', out_role: 'superadmin', out_version: before.out_version + 1 })
  })

  it('set_admin_password cambia el hash y sube la version de sesion; sin cuenta no hace nada', async () => {
    const before = await login('facufede')
    const [r] = await q<{ out_version: number }>(db, `select * from set_admin_password($1, 'scrypt$hash3')`, [before.out_user])
    expect(r.out_version).toBe(before.out_version + 1)
    expect((await login('facufede')).out_hash).toBe('scrypt$hash3')
    const [other] = await q<{ id: string }>(db, `insert into users (email) values ('x@x.com') returning id`)
    expect(await q(db, `select * from set_admin_password($1, 'scrypt$x')`, [other.id])).toEqual([])
  })

  it('admin_account_of: solo las cuentas con contraseña', async () => {
    const acc = await login('facufede')
    expect((await q<{ out_username: string }>(db, 'select * from admin_account_of($1)', [acc.out_user]))[0].out_username).toBe('facufede')
    const [other] = await q<{ id: string }>(db, `select id from users where email = 'x@x.com'`)
    expect(await q(db, 'select * from admin_account_of($1)', [other.id])).toEqual([])
  })

  it('usuario inexistente o con caracteres raros', async () => {
    expect(await login('nadie')).toBeUndefined()
    await expect(q(db, `select * from create_admin_account('con espacios', 'h')`)).rejects.toThrow()
  })
})
