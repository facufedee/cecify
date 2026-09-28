import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let admin: string
let ana: string
let bea: string

type Found = { out_id: string; out_name: string; out_side: string | null; out_claimed: boolean; out_returning: boolean; out_registration_open: boolean }
type Reg = { out_status: string; out_id: string | null; out_role: string | null; out_version: number | null }
type Attempt = Reg & { out_left: number | null; out_locked_until: string | null }

const search = (query: string) => q<Found>(db, 'select * from guest_search($1)', [query])
const register = async (guest: string, hash = 'scrypt$pin') => (await q<Reg>(db, 'select * from guest_register($1, $2)', [guest, hash]))[0]
const attempt = async (guest: string, ok: boolean) => (await q<Attempt>(db, 'select * from guest_pin_attempt($1, $2)', [guest, ok]))[0]
const setWindow = (opens: string, closes: string) =>
  q(db, `select * from admin_set_event_access($1, 'clave-que-ya-no-se-usa-xx', now() + $2::interval, now() + $3::interval)`, [admin, opens, closes])

beforeAll(async () => {
  db = await createDb()
  admin = await createUser(db, 'Admin')
  await q(db, `update users set role = 'admin' where id = $1`, [admin])
  for (const [n, c] of [['Ana Ruiz', 'ANAR0001'], ['Bea Gómez', 'BEAG0001']]) {
    await q(db, 'select * from admin_upsert_guest($1, $2, NULL, $3)', [admin, n, c])
  }
  ;[ana, bea] = [(await search('ana ruiz'))[0].out_id, (await search('bea'))[0].out_id]
})
afterAll(async () => {
  await db.close()
})

describe('registro cerrado', () => {
  it('sin horario configurado el registro esta cerrado y nadie nuevo se puede registrar', async () => {
    expect((await search('ana'))[0]).toMatchObject({ out_claimed: false, out_registration_open: false })
    expect((await register(ana)).out_status).toBe('closed')
  })
})

describe('primera vez (registro abierto)', () => {
  it('se elige, guarda el PIN y entra', async () => {
    await setWindow('-1 hour', '11 hours')
    expect((await search('ana'))[0].out_registration_open).toBe(true)
    expect(await register(ana)).toMatchObject({ out_status: 'ok', out_role: 'guest' })
    expect((await search('ana'))[0].out_claimed).toBe(true)
    const [g] = await q<{ pin_hash: string }>(db, 'select pin_hash from guests where id = $1', [ana])
    expect(g.pin_hash).toBe('scrypt$pin')
  })

  it('un nombre ya registrado no se puede volver a registrar', async () => {
    expect((await register(ana, 'scrypt$otro')).out_status).toBe('taken')
    const [g] = await q<{ pin_hash: string }>(db, 'select pin_hash from guests where id = $1', [ana])
    expect(g.pin_hash).toBe('scrypt$pin')
  })
})

describe('entrar con el PIN', () => {
  it('funciona aunque el registro este cerrado', async () => {
    await setWindow('-12 hours', '-1 hour')
    expect((await q(db, 'select * from guest_pin_for_login($1)', [ana]))).toHaveLength(1)
    expect((await attempt(ana, true)).out_status).toBe('ok')
  })

  it('quien no se registro no tiene PIN para entrar', async () => {
    expect(await q(db, 'select * from guest_pin_for_login($1)', [bea])).toEqual([])
    expect((await attempt(bea, true)).out_status).toBe('not_found')
  })

  it('5 intentos fallidos traban el nombre 15 minutos; ni con el PIN correcto entra', async () => {
    const lefts = []
    for (let i = 0; i < 4; i++) lefts.push((await attempt(ana, false)).out_left)
    expect(lefts).toEqual([4, 3, 2, 1])
    const fifth = await attempt(ana, false)
    expect(fifth.out_status).toBe('locked')
    expect(Date.parse(fifth.out_locked_until!) - Date.now()).toBeGreaterThan(14 * 60_000)
    expect((await attempt(ana, true)).out_status).toBe('locked')
  })

  it('pasado el bloqueo vuelve a entrar y se reinician los intentos', async () => {
    await q(db, `update guests set pin_locked_until = now() - interval '1 second' where id = $1`, [ana])
    expect((await attempt(ana, true)).out_status).toBe('ok')
    expect((await attempt(ana, false)).out_left).toBe(4)
  })
})

describe('liberar (olvido el PIN o cambio de dueño)', () => {
  it('borra el PIN, cierra sus sesiones y puede inventar otro aunque el registro este cerrado (misma cuenta)', async () => {
    const [before] = await q<{ id: string; v: number }>(db, `select id, session_version as v from users where email = $1`, [`g-${ana}@lista.invalid`])
    expect((await q<{ out_status: string }>(db, 'select * from admin_release_guest($1, $2)', [admin, ana]))[0].out_status).toBe('ok')
    expect(await q(db, 'select * from guest_pin_for_login($1)', [ana])).toEqual([])
    await setWindow('-12 hours', '-1 hour') // registro cerrado
    expect((await search('ana ruiz'))[0]).toMatchObject({ out_claimed: false, out_returning: true, out_registration_open: false })
    expect((await search('bea'))[0].out_returning).toBe(false)
    expect((await register(bea)).out_status).toBe('closed') // gente nueva: no
    const again = await register(ana, 'scrypt$nuevo') // a quien le reiniciaron el PIN: si
    expect(again.out_id).toBe(before.id)
    expect(again.out_version).toBe(before.v + 1)
  })
})
