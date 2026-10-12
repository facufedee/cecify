// Contrato TS <-> SQL: corre las funciones reales de lib/db contra Postgres en memoria. callFn llama por nombre de
// argumento, asi que un p_* mal escrito o que falta recien se ve aca (tsc no lo detecta).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDb, createUser, createWedding, q, type Db } from '../helpers/db'

const holder = vi.hoisted(() => ({ db: null as unknown }))

// Igual que callFn en modo local (lib/db/core.ts)
vi.mock('@/lib/db/core', () => ({
  callFn: async (fn: string, args: Record<string, unknown>) => {
    const db = holder.db as Db
    const keys = Object.keys(args)
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
    return (await db.query(`select * from ${fn}(${named})`, keys.map((k) => args[k]))).rows
  },
  iso: (v: string | Date) => new Date(v).toISOString(),
}))

const { adminUpdateWedding, createWedding: createWeddingTs, weddingByCode, weddingOfUser } = await import('@/lib/db/weddings')
const { guestPinAttempt, guestPinForLogin, guestRegister, guestSearch, registrationOpen } = await import('@/lib/db/guest-login')
const { getAuthor, getProfileOwner, userIdForProfile } = await import('@/lib/db/profiles')
const { adminGetEventAccess, adminSetEventAccess } = await import('@/lib/db/event')

let db: Db

beforeAll(async () => {
  db = await createDb()
  holder.db = db
})
afterAll(async () => {
  await db.close()
})

describe('lib/db/weddings', () => {
  it('crea un casamiento y lo encuentra por codigo (sin importar como lo escriban)', async () => {
    const r = await createWeddingTs('Ana', 'Beto', 'anabeto', 'scrypt$x')
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)

    const found = await weddingByCode(`${r.code.slice(0, 3).toLowerCase()} ${r.code.slice(3)}`)
    expect(found).toEqual({ id: r.weddingId, partnerA: 'Ana', partnerB: 'Beto', registrationOpen: false })
    expect(await weddingByCode('ZZZZZZ')).toBeNull()

    expect(await weddingOfUser(r.userId)).toEqual({
      id: r.weddingId,
      code: r.code,
      partnerA: 'Ana',
      partnerB: 'Beto',
      opensAt: null,
      closesAt: null,
    })
  })

  it('devuelve los errores del alta tal cual', async () => {
    expect(await createWeddingTs('Ana', 'Beto', 'anabeto', 'h')).toEqual({ status: 'username_taken' })
    expect(await createWeddingTs('', 'Beto', 'otro', 'h')).toEqual({ status: 'invalid_names' })
    expect(await createWeddingTs('Ana', 'Beto', 'x', 'h')).toEqual({ status: 'invalid_username' })
  })

  it('solo el dueño cambia los nombres', async () => {
    const w = await createWedding(db, 'Caro', 'Dani', 'carodani')
    const guest = await createUser(db, 'InvitadoCD', w.id)
    expect(await adminUpdateWedding(guest, 'X', 'Y')).toBe('forbidden')
    expect(await adminUpdateWedding(w.owner, '  ', 'Y')).toBe('invalid')
    expect(await adminUpdateWedding(w.owner, 'Carolina', 'Daniel')).toBe('ok')
    expect((await weddingOfUser(w.owner))?.partnerA).toBe('Carolina')
  })

  it('con el horario abierto lo informa, y el panel lo cambia sin clave de QR', async () => {
    const w = await createWedding(db, 'Eva', 'Fede', 'evafede')
    const opens = new Date(Date.now() - 3600_000).toISOString()
    const closes = new Date(Date.now() + 3600_000).toISOString()
    expect(await adminSetEventAccess(w.owner, opens, closes)).toBe(true)
    expect((await weddingByCode(w.code))?.registrationOpen).toBe(true)
    expect(await adminGetEventAccess(w.owner)).toMatchObject({ key: w.code, opensAt: opens, closesAt: closes })
    expect(await weddingOfUser(w.owner)).toMatchObject({ opensAt: opens, closesAt: closes })
  })
})

describe('login de invitados con codigo', () => {
  let code: string
  let gina: string

  beforeAll(async () => {
    const w = await createWedding(db, 'Gina', 'Hugo', 'ginahugo')
    code = w.code
    await q(db, `select * from admin_set_event_access($1, NULL, now() - interval '1 hour', now() + interval '1 hour')`, [w.owner])
    await q(db, `select * from admin_upsert_guest($1, 'Gina Invitada', NULL, 'GINA0001')`, [w.owner])
    gina = (await guestSearch('gina inv', code)).guests[0].id
  })

  it('busca, registra y entra dentro de ese casamiento', async () => {
    const found = await guestSearch('gina inv', code)
    expect(found.guests).toHaveLength(1)
    expect(found.registrationOpen).toBe(true)
    expect(found.guests[0].id).toBe(gina)
    expect(await registrationOpen(code)).toBe(true)

    const reg = await guestRegister(gina, 'scrypt$pin', code)
    expect(reg.status).toBe('ok')
    expect(await guestPinForLogin(gina, code)).toEqual({ hash: 'scrypt$pin', lockedUntil: null })
    expect((await guestPinAttempt(gina, true, code)).status).toBe('ok')
  })

  it('con otro codigo no existe', async () => {
    expect((await guestSearch('gina inv', 'ZZZZZZ')).guests).toEqual([])
    expect(await registrationOpen('ZZZZZZ')).toBe(false)
    expect(await guestPinForLogin(gina, 'ZZZZZZ')).toBeNull()
    expect(await guestPinAttempt(gina, true, 'ZZZZZZ')).toEqual({ status: 'not_found' })
    expect(await guestRegister(gina, 'h', 'ZZZZZZ')).toEqual({ status: 'not_found' })
  })
})

describe('perfiles: nunca de otro casamiento', () => {
  it('getAuthor y getProfileOwner devuelven null para alguien de otro casamiento', async () => {
    const a = await createWedding(db, 'Ines', 'Juan', 'inesjuan')
    const b = await createWedding(db, 'Kari', 'Leo', 'karileo')
    const inA = await createUser(db, 'Viewer', a.id)
    const otherA = await createUser(db, 'MismaBoda', a.id)
    const inB = await createUser(db, 'Ajena', b.id)
    const [profileB] = await q<{ id: string }>(db, 'select id from profiles where user_id = $1', [inB])
    const [profileA] = await q<{ id: string }>(db, 'select id from profiles where user_id = $1', [otherA])

    expect(await getAuthor(inB, inA)).toBeNull()
    expect(await getAuthor(otherA, inA)).toMatchObject({ name: 'MismaBoda' })
    expect(await getProfileOwner(profileB.id, inA)).toBeNull()
    expect(await getProfileOwner(profileA.id, inA)).toMatchObject({ userId: otherA })
    expect(await userIdForProfile(profileB.id, inA)).toBeNull()
  })
})
