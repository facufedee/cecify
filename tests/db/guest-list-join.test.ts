import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let admin: string
const KEY = 'clave-de-la-fiesta-lista'

type Found = { out_status: string; out_id: string | null; out_name: string | null; out_side: string | null; out_taken: boolean | null }
type Claim = { out_status: string; out_id: string | null; out_role: string | null; out_version: number | null }

const search = (query: string, key = KEY) => q<Found>(db, 'select * from event_search_guests($1, $2)', [key, query])
const claim = async (guest: string, key = KEY) => (await q<Claim>(db, 'select * from event_claim_guest($1, $2)', [key, guest]))[0]
const addGuest = async (name: string, code: string, email: string | null = null, side: string | null = null) =>
  (await q<{ out_id: string }>(db, 'select * from admin_upsert_guest($1, $2, $3, $4, $5)', [admin, name, email, code, side]))[0].out_id
const release = async (guest: string, actor = admin) =>
  (await q<{ out_status: string }>(db, 'select * from admin_release_guest($1, $2)', [actor, guest]))[0].out_status

beforeAll(async () => {
  db = await createDb()
  admin = await createUser(db, 'Admin')
  await q(db, `update users set role = 'admin' where id = $1`, [admin])
  await q(db, `select * from admin_set_event_access($1, $2, now() - interval '1 hour', now() + interval '11 hours')`, [admin, KEY])
})
afterAll(async () => {
  await db.close()
})

describe('lista de invitados sin email', () => {
  it('se cargan solo con el nombre; volver a importarlos no los duplica', async () => {
    await addGuest('José Pérez', 'JOSE1111', null, 'groom')
    await addGuest('  jose pérez ', 'JOSE2222') // el mismo, escrito distinto
    await addGuest('Mariana López', 'MARI1111', null, 'bride')
    await addGuest('Ana Ruiz', 'ANAR1111')
    expect(await q(db, `select 1 from guests where fold_name(name) = 'jose perez'`)).toHaveLength(1)
  })
})

describe('buscar en la lista', () => {
  it('sin acentos ni mayusculas; primero los que empiezan con lo buscado', async () => {
    expect((await search('jose')).map((r) => r.out_name)).toEqual(['jose pérez'])
    expect((await search('ANA')).map((r) => r.out_name)).toEqual(['Ana Ruiz', 'Mariana López'])
    expect((await search('lopez'))[0]).toMatchObject({ out_status: 'ok', out_side: 'bride', out_taken: false })
  })

  it('con menos de 2 letras no devuelve nada (no se puede listar a todos)', async () => {
    expect(await search('a')).toEqual([])
    expect(await search('  ')).toEqual([])
  })

  it('no muestra a quienes entraron solos con WhatsApp o Instagram', async () => {
    await q(db, `insert into guests (name, email, access_code) values ('Ana Suelta', '5491100000000@whatsapp.invalid', 'WAPP1111')`)
    expect((await search('ana')).map((r) => r.out_name)).not.toContain('Ana Suelta')
  })

  it('con el QR invalido o cerrado no devuelve nombres', async () => {
    expect(await search('ana', 'otra-clave-cualquiera-xx')).toEqual([expect.objectContaining({ out_status: 'invalid', out_name: null })])
  })
})

describe('elegirse', () => {
  it('crea la cuenta con un email interno y el nombre queda tomado', async () => {
    const [ana] = await search('ana ruiz')
    const r = await claim(ana.out_id!)
    expect(r).toMatchObject({ out_status: 'ok', out_role: 'guest' })
    const [g] = await q<{ email: string }>(db, 'select email from guests where id = $1', [ana.out_id])
    expect(g.email).toBe(`g-${ana.out_id}@lista.invalid`)
    expect((await search('ana ruiz'))[0].out_taken).toBe(true)
    // el nombre que se ve es el de la lista (get_user_context lo toma de guests)
    const [ctx] = await q<{ out_guest_name: string }>(db, 'select * from get_user_context($1)', [r.out_id])
    expect(ctx.out_guest_name).toBe('Ana Ruiz')
  })

  it('un nombre tomado no se puede volver a elegir', async () => {
    const [ana] = await search('ana ruiz')
    expect((await claim(ana.out_id!)).out_status).toBe('taken')
  })

  it('quien entro con su codigo de invitacion tambien tiene el nombre tomado', async () => {
    const id = await addGuest('Luis Gómez', 'LUIS1111', 'luis@x.com')
    await q(db, `select * from upsert_user('luis@x.com')`)
    expect((await claim(id)).out_status).toBe('taken')
  })

  it('no se pueden elegir las cuentas de WhatsApp/Instagram ni un id inventado', async () => {
    const [w] = await q<{ id: string }>(db, `select id from guests where name = 'Ana Suelta'`)
    expect((await claim(w.id)).out_status).toBe('not_found')
    expect((await claim('00000000-0000-0000-0000-000000000000')).out_status).toBe('not_found')
  })

  it('con el QR invalido no se elige a nadie', async () => {
    const [m] = await search('mariana')
    expect((await claim(m.out_id!, 'otra-clave-cualquiera-xx')).out_status).toBe('invalid')
    expect((await search('mariana'))[0].out_taken).toBe(false)
  })
})

describe('liberar un nombre (cambio de celular)', () => {
  it('lo libera, cierra sus sesiones y al volver a elegirse es la misma cuenta', async () => {
    const [m] = await search('mariana')
    const first = await claim(m.out_id!)
    expect(await release(m.out_id!)).toBe('ok')
    expect((await search('mariana'))[0].out_taken).toBe(false)
    const again = await claim(m.out_id!)
    expect(again.out_id).toBe(first.out_id)
    expect(again.out_version).toBe(first.out_version! + 1) // el celular viejo quedo afuera
  })

  it('un invitado comun no puede liberar; un nombre libre responde not_claimed', async () => {
    const guest = await createUser(db, 'Comun')
    const [j] = await search('jose')
    expect(await release(j.out_id!, guest)).toBe('forbidden')
    expect(await release(j.out_id!)).toBe('not_claimed')
  })

  it('el panel muestra si el nombre ya se eligio', async () => {
    const rows = await q<{ guest_name: string; guest_claimed: boolean }>(db, 'select * from admin_list_guests($1, $2)', [admin, 'mariana'])
    expect(rows[0]).toMatchObject({ guest_name: 'Mariana López', guest_claimed: true })
  })
})
