import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let admin: string
let guest: string
const KEY = 'clave-de-la-fiesta-1234'

type Join = { out_status: string; out_id: string | null; out_role: string | null; out_version: number | null; out_existing: boolean | null }
const join = async (key: string, name: string, phone: string, code: string) =>
  (await q<Join>(db, 'select * from event_join($1, $2, $3, $4)', [key, name, `${phone}@whatsapp.invalid`, code]))[0]

const setWindow = (key: string | null, opens: string, closes: string, actor = admin) =>
  q<{ out_ok: boolean }>(db, `select * from admin_set_event_access($1, $2, now() + $3::interval, now() + $4::interval)`, [
    actor,
    key,
    opens,
    closes,
  ])

beforeAll(async () => {
  db = await createDb()
  admin = await createUser(db, 'Admin')
  guest = await createUser(db, 'Guest')
  await q(db, `update users set role = 'admin' where id = $1`, [admin])
})
afterAll(async () => {
  await db.close()
})

describe('sin activar', () => {
  it('el QR no sirve hasta que un admin lo activa', async () => {
    expect((await join(KEY, 'Ana', '5491100000001', 'CODE0001')).out_status).toBe('invalid')
  })
})

describe('con el QR activo', () => {
  beforeEach(async () => {
    await setWindow(KEY, '-1 hour', '11 hours')
  })

  it('crea la cuenta y la deja en la lista de invitados con su nombre', async () => {
    const r = await join(KEY, ' Ana ', '5491100000002', 'CODE0002')
    expect(r).toMatchObject({ out_status: 'ok', out_role: 'guest', out_existing: false })
    const [g] = await q<{ name: string }>(db, `select name from guests where email = '5491100000002@whatsapp.invalid'`)
    expect(g.name).toBe('Ana')
  })

  it('con el mismo WhatsApp recupera la cuenta, cierra la sesion anterior y no deja renombrarla', async () => {
    const first = await join(KEY, 'Beto', '5491100000003', 'CODE0003')
    const again = await join(KEY, 'Otro Nombre', '5491100000003', 'CODE0004')
    expect(again).toMatchObject({ out_status: 'ok', out_id: first.out_id, out_existing: true })
    expect(again.out_version).toBe(first.out_version! + 1)
    const [g] = await q<{ name: string }>(db, `select name from guests where email = '5491100000003@whatsapp.invalid'`)
    expect(g.name).toBe('Beto')
  })

  it('una clave que no es no entra', async () => {
    expect((await join('otra-clave-cualquiera-xx', 'Eve', '5491100000005', 'CODE0005')).out_status).toBe('invalid')
  })

  it('cambiar el QR invalida el anterior', async () => {
    await setWindow('clave-nueva-de-la-fiesta', '-1 hour', '11 hours')
    expect((await join(KEY, 'Eve', '5491100000006', 'CODE0006')).out_status).toBe('invalid')
    expect((await join('clave-nueva-de-la-fiesta', 'Eve', '5491100000006', 'CODE0006')).out_status).toBe('ok')
  })

  it('p_key NULL conserva la clave y solo cambia el horario', async () => {
    await setWindow(null, '-2 hours', '10 hours')
    const [e] = await q<{ out_key: string }>(db, 'select * from admin_get_event_access($1)', [admin])
    expect(e.out_key).toBe(KEY)
  })
})

describe('horario', () => {
  it('antes de abrir y despues de cerrar responde "closed"', async () => {
    await setWindow(KEY, '1 hour', '12 hours')
    expect((await join(KEY, 'Temprano', '5491100000007', 'CODE0007')).out_status).toBe('closed')
    await setWindow(KEY, '-12 hours', '-1 hour')
    expect((await join(KEY, 'Tarde', '5491100000008', 'CODE0008')).out_status).toBe('closed')
    expect(await q(db, `select 1 from guests where email in ('5491100000007@whatsapp.invalid', '5491100000008@whatsapp.invalid')`)).toEqual([])
  })

  it('el cierre tiene que ser despues de la apertura', async () => {
    await expect(setWindow(KEY, '2 hours', '1 hour')).rejects.toThrow()
  })
})

describe('permisos', () => {
  it('un invitado comun no ve ni cambia la configuracion', async () => {
    expect(await q(db, 'select * from admin_get_event_access($1)', [guest])).toEqual([])
    expect((await setWindow('clave-de-un-invitado-xx', '-1 hour', '1 hour', guest))[0].out_ok).toBe(false)
    const [e] = await q<{ out_key: string }>(db, 'select * from admin_get_event_access($1)', [admin])
    expect(e.out_key).toBe(KEY)
  })

  it('el panel cuenta cuantos entraron con el QR', async () => {
    const [e] = await q<{ out_joined: number }>(db, 'select * from admin_get_event_access($1)', [admin])
    expect(e.out_joined).toBe(3) // Ana, Beto y Eve
  })
})
