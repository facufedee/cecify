import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let a: string
let b: string
let c: string
let root: string // superadmin

beforeAll(async () => {
  db = await createDb()
  ;[a, b, c, root] = [
    await createUser(db, 'A'),
    await createUser(db, 'B'),
    await createUser(db, 'C'),
    await createUser(db, 'Root'),
  ]
  await q(db, `update users set role = 'superadmin' where id = $1`, [root])
})
afterAll(async () => {
  await db.close()
})

const setRole = async (actor: string, target: string, role: string) =>
  (await q<{ status: string; new_role: string | null }>(db, 'select * from set_user_role($1, $2, $3)', [
    actor,
    target,
    role,
  ]))[0]

const roleOf = async (id: string) => (await q<{ role: string }>(db, 'select role::text from users where id = $1', [id]))[0].role

describe('set_user_role', () => {
  it('un superadmin puede nombrar y quitar administradores', async () => {
    expect(await setRole(root, a, 'admin')).toMatchObject({ status: 'ok', new_role: 'admin' })
    expect(await roleOf(a)).toBe('admin')
    expect(await setRole(root, a, 'guest')).toMatchObject({ status: 'ok' })
    expect(await roleOf(a)).toBe('guest')
  })

  it('un invitado o un admin no pueden cambiar roles (ni el propio)', async () => {
    expect((await setRole(b, b, 'superadmin')).status).toBe('forbidden')
    expect(await roleOf(b)).toBe('guest')

    await setRole(root, c, 'admin')
    expect((await setRole(c, b, 'admin')).status).toBe('forbidden')
    expect((await setRole(c, c, 'superadmin')).status).toBe('forbidden')
    expect(await roleOf(c)).toBe('admin')
  })

  it('rechaza roles que no existen y usuarios inexistentes', async () => {
    expect((await setRole(root, a, 'dios')).status).toBe('invalid')
    expect((await setRole(root, a, 'GUEST')).status).toBe('invalid')
    expect((await setRole(root, '00000000-0000-0000-0000-000000000000', 'admin')).status).toBe('not_found')
    // un id que no existe tampoco es superadmin
    expect((await setRole('00000000-0000-0000-0000-000000000000', a, 'admin')).status).toBe('forbidden')
  })

  it('no deja el sistema sin superadmin', async () => {
    expect((await setRole(root, root, 'guest')).status).toBe('last_superadmin')
    expect(await roleOf(root)).toBe('superadmin')

    // con otro superadmin ya se puede renunciar
    await setRole(root, a, 'superadmin')
    expect((await setRole(root, root, 'admin')).status).toBe('ok')
    expect(await roleOf(root)).toBe('admin')
    // el ultimo que queda no puede bajarse
    expect((await setRole(a, a, 'guest')).status).toBe('last_superadmin')
  })
})

describe('modo "solo muro" (wants_match = false)', () => {
  const names = async (viewer: string) =>
    (await q<{ name: string }>(db, 'select * from discover_profiles($1)', [viewer])).map((r) => r.name).sort()

  it('el perfil por defecto participa del match y quien se baja desaparece de Descubrir', async () => {
    expect(await names(a)).toContain('B')
    await q(db, 'update profiles set wants_match = false where user_id = $1', [b])
    expect(await names(a)).not.toContain('B')
    await q(db, 'update profiles set wants_match = true where user_id = $1', [b])
    expect(await names(a)).toContain('B')
  })

  it('quien no participa no ve a nadie en Descubrir', async () => {
    await q(db, 'update profiles set wants_match = false where user_id = $1', [b])
    expect(await names(b)).toEqual([])
    await q(db, 'update profiles set wants_match = true where user_id = $1', [b])
  })

  it('no se puede hacer match con alguien que solo usa el muro (aunque haya likes cruzados)', async () => {
    // Like previo, cuando ambos participaban
    await q(db, 'select * from record_swipe($1, $2, $3::swipe_action)', [b, c, 'like'])
    await q(db, 'update profiles set wants_match = false where user_id = $1', [c])

    const [res] = await q<{ matched: boolean; was_duplicate: boolean }>(
      db,
      'select * from record_swipe($1, $2, $3::swipe_action)',
      [c, b, 'like']
    )
    expect(res).toMatchObject({ matched: false, was_duplicate: true })
    expect(await q(db, 'select 1 from matches')).toHaveLength(0)
    expect(await q(db, 'select 1 from swipes where from_user_id = $1', [c])).toHaveLength(0)

    // tampoco si el que swipea es el que no participa
    const [res2] = await q<{ matched: boolean }>(db, 'select * from record_swipe($1, $2, $3::swipe_action)', [c, a, 'like'])
    expect(res2.matched).toBe(false)
    expect(await q(db, 'select 1 from swipes where from_user_id = $1', [c])).toHaveLength(0)
  })

  it('al volver a participar se puede hacer match y se guardan lado y que busca', async () => {
    await q(db, `update profiles set wants_match = true, side = 'bride', looking_for = ARRAY['dance'] where user_id = $1`, [c])
    const [res] = await q<{ matched: boolean }>(db, 'select * from record_swipe($1, $2, $3::swipe_action)', [c, b, 'like'])
    expect(res.matched).toBe(true)

    const rows = await q<{ side: string | null; looking_for: string[] }>(db, 'select * from discover_profiles($1)', [a])
    expect(rows.every((r) => Array.isArray(r.looking_for))).toBe(true)
  })
})

describe('restricciones de perfil', () => {
  it('solo acepta lados y busquedas conocidos', async () => {
    await expect(q(db, `update profiles set side = 'otro' where user_id = $1`, [a])).rejects.toThrow()
    await expect(q(db, `update profiles set looking_for = ARRAY['casarse'] where user_id = $1`, [a])).rejects.toThrow()
    await expect(
      q(db, `insert into guests (name, email, access_code, side) values ('X', 'x@x.com', 'XXXX1111', 'otro')`)
    ).rejects.toThrow()
    // y uno valido se guarda
    await q(db, `insert into guests (name, email, access_code, side) values ('Y', 'y@x.com', 'YYYY2222', 'groom')`)
  })
})
