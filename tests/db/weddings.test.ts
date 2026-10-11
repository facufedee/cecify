import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, createWedding, migratedWedding, q, type Db } from '../helpers/db'

const WEDDINGS = '20261011100000_weddings.sql'
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

type Found = { out_id: string; out_name: string; out_claimed: boolean; out_returning: boolean; out_registration_open: boolean }
type Reg = { out_status: string; out_id: string | null; out_role: string | null; out_version: number | null }

describe('migracion: los datos existentes pasan a un casamiento', () => {
  let old: PGlite
  afterAll(async () => {
    await old.close()
  })

  it('crea "Cecilia & Lucas" con codigo, copia el horario y le asigna todos los usuarios e invitados', async () => {
    old = new PGlite()
    const dir = path.join(process.cwd(), 'supabase', 'migrations')
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files.filter((f) => f < WEDDINGS)) await old.exec(readFileSync(path.join(dir, file), 'utf8'))

    await old.exec(`
      INSERT INTO event_access (id, join_key, opens_at, closes_at)
      VALUES (TRUE, 'clave-vieja-de-la-fiesta', '2026-01-01T10:00:00Z', '2026-01-01T22:00:00Z');
      INSERT INTO users (email) VALUES ('ana@x.com'), ('root@admin.invalid');
      INSERT INTO guests (name, email, access_code) VALUES ('Ana', 'ana@x.com', 'ANAA1111');
      INSERT INTO guests (name, email, access_code) VALUES ('Sin Mail', NULL, 'SINM1111');
    `)
    for (const file of files.filter((f) => f >= WEDDINGS)) await old.exec(readFileSync(path.join(dir, file), 'utf8'))

    const weddings = await q<{ id: string; partner_a: string; partner_b: string; code: string; opens_at: Date; closes_at: Date }>(
      old,
      'select * from weddings'
    )
    expect(weddings).toHaveLength(1)
    const [w] = weddings
    expect(w).toMatchObject({ partner_a: 'Cecilia', partner_b: 'Lucas' })
    expect(w.code).toMatch(CODE)
    expect(w.opens_at.toISOString()).toBe('2026-01-01T10:00:00.000Z')
    expect(w.closes_at.toISOString()).toBe('2026-01-01T22:00:00.000Z')
    expect(await q(old, 'select 1 from users where wedding_id is distinct from $1', [w.id])).toEqual([])
    expect(await q(old, 'select 1 from guests where wedding_id is distinct from $1', [w.id])).toEqual([])
    expect((await q(old, 'select 1 from users'))).toHaveLength(2)
    // la fila unica del QR viejo ya no existe: el horario vive en el casamiento
    expect(await q(old, `select 1 from pg_class where relname = 'event_access'`)).toEqual([])
  })
})

describe('compatibilidad: la app de antes llama sin codigo de casamiento', () => {
  let db: Db
  let admin: string
  let ana: string
  let bea: string

  // Igual que callFn: argumentos con nombre, exactamente los que manda lib/db/guest-login.ts hoy
  const fn = <T = Record<string, unknown>>(name: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args)
    return q<T>(db, `select * from ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k]))
  }

  beforeAll(async () => {
    db = await createDb()
    admin = await createUser(db, 'AdminCompat')
    await q(db, `update users set role = 'admin' where id = $1`, [admin])
    await q(db, `select * from admin_set_event_access($1, NULL, now() - interval '1 hour', now() + interval '11 hours')`, [admin])
    for (const [n, c] of [['Ana Compat', 'ANAC0001'], ['Bea Compat', 'BEAC0001']]) {
      await q(db, 'select * from admin_upsert_guest($1, $2, NULL, $3)', [admin, n, c])
    }
    await q(db, `select * from admin_upsert_guest($1, 'Cai Compat', 'cai@x.com', 'CAIC0001')`, [admin])
    ;[ana, bea] = [(await fn<Found>('guest_search', { p_query: 'ana compat' }))[0].out_id, (await fn<Found>('guest_search', { p_query: 'bea compat' }))[0].out_id]
  })
  afterAll(async () => {
    await db.close()
  })

  it('con un solo casamiento todo sigue andando sin codigo', async () => {
    expect((await fn<{ out_open: boolean }>('registration_status', {}))[0].out_open).toBe(true)
    expect((await fn<Found>('guest_search', { p_query: 'compat' })).map((r) => r.out_name)).toHaveLength(3)
    expect((await fn<Reg>('guest_register', { p_guest: ana, p_pin_hash: 'scrypt$pin' }))[0].out_status).toBe('ok')
    expect(await fn('guest_pin_for_login', { p_guest: ana })).toHaveLength(1)
    expect((await fn<Reg>('guest_pin_attempt', { p_guest: ana, p_ok: true }))[0].out_status).toBe('ok')
    expect(await fn('find_guest', { p_email: 'cai@x.com', p_code: 'CAIC0001' })).toHaveLength(1)
    expect((await fn<{ out_email: string }>('upsert_user', { p_email: 'cai@x.com' }))[0].out_email).toBe('cai@x.com')
  })

  it('con dos casamientos, sin codigo no encuentra a nadie ni deja entrar', async () => {
    await createWedding(db, 'Otra', 'Pareja', 'otra-pareja')
    expect((await fn<{ out_open: boolean }>('registration_status', {}))[0].out_open).toBe(false)
    expect(await fn('guest_search', { p_query: 'compat' })).toEqual([])
    expect((await fn<Reg>('guest_register', { p_guest: bea, p_pin_hash: 'scrypt$pin' }))[0].out_status).toBe('not_found')
    expect(await fn('guest_pin_for_login', { p_guest: ana })).toEqual([])
    expect((await fn<Reg>('guest_pin_attempt', { p_guest: ana, p_ok: true }))[0].out_status).toBe('not_found')
    expect(await fn('find_guest', { p_email: 'cai@x.com', p_code: 'CAIC0001' })).toEqual([])
    await expect(fn('upsert_user', { p_email: 'nuevo@x.com' })).rejects.toThrow()
    expect((await q<{ claimed_at: Date | null }>(db, 'select claimed_at from guests where id = $1', [bea]))[0].claimed_at).toBeNull()
  })
})

describe('varios casamientos', () => {
  let db: Db
  let A: { id: string; code: string; owner: string }
  let B: { id: string; code: string; owner: string }

  const search = (code: string, query: string) => q<Found>(db, 'select * from guest_search($1, $2)', [query, code])
  const register = async (code: string, guest: string, hash = 'scrypt$pin') =>
    (await q<Reg>(db, 'select * from guest_register($1, $2, $3)', [guest, hash, code]))[0]
  const addGuest = async (actor: string, name: string, email: string | null, code: string) =>
    (await q<{ out_id: string }>(db, 'select * from admin_upsert_guest($1, $2, $3, $4)', [actor, name, email, code]))[0]?.out_id
  const openWindow = (actor: string) =>
    q<{ out_ok: boolean }>(db, `select * from admin_set_event_access($1, NULL, now() - interval '1 hour', now() + interval '11 hours')`, [actor])

  beforeAll(async () => {
    db = await createDb()
    const migrated = await migratedWedding(db)
    A = { ...migrated, owner: (await q<{ out_user: string }>(db, `select * from create_admin_account('dueno-a', 'scrypt$a')`))[0].out_user }
    B = await createWedding(db, 'Marta', 'Pedro', 'marta-pedro')
  })
  afterAll(async () => {
    await db.close()
  })

  describe('create_wedding', () => {
    it('crea el casamiento con codigo de 6 caracteres sin ambiguos y un dueño superadmin con su cuenta', async () => {
      expect(B.code).toMatch(CODE)
      expect(B.code).not.toBe(A.code)
      const [u] = await q<{ wedding_id: string; role: string; email: string }>(db, 'select wedding_id, role, email from users where id = $1', [B.owner])
      expect(u).toEqual({ wedding_id: B.id, role: 'superadmin', email: 'marta-pedro@admin.invalid' })
      const [acc] = await q<{ out_user: string; out_hash: string }>(db, `select * from admin_account_for_login('MARTA-PEDRO')`)
      expect(acc).toMatchObject({ out_user: B.owner, out_hash: 'scrypt$owner' })
      // registro de gente nueva: cerrado hasta que el dueño elige el horario
      expect(await q(db, 'select * from admin_get_event_access($1)', [B.owner])).toEqual([])
    })

    it('con un usuario tomado no crea nada y responde username_taken', async () => {
      const before = (await q(db, 'select 1 from weddings')).length
      const [r] = await q<{ out_status: string; out_wedding: string | null }>(db, `select * from create_wedding('X', 'Y', ' Marta-Pedro ', 'h')`)
      expect(r).toMatchObject({ out_status: 'username_taken', out_wedding: null })
      expect(await q(db, 'select 1 from weddings')).toHaveLength(before)
    })

    it('rechaza nombres vacios y usuarios con caracteres raros', async () => {
      expect((await q<{ out_status: string }>(db, `select * from create_wedding(' ', 'Y', 'valido', 'h')`))[0].out_status).toBe('invalid_names')
      expect((await q<{ out_status: string }>(db, `select * from create_wedding('X', 'Y', 'con espacios', 'h')`))[0].out_status).toBe('invalid_username')
    })

    it('los codigos son unicos (muchos casamientos)', async () => {
      const codes = new Set([A.code, B.code])
      for (let i = 0; i < 30; i++) codes.add((await createWedding(db, 'X', 'Y', `pareja-${i}`)).code)
      expect(codes.size).toBe(32)
      for (const c of codes) expect(c).toMatch(CODE)
    })
  })

  describe('wedding_by_code / wedding_of_user / admin_update_wedding', () => {
    it('wedding_by_code ignora mayusculas y espacios; un codigo que no existe no devuelve nada', async () => {
      const [w] = await q<{ out_id: string; out_partner_a: string; out_partner_b: string; out_registration_open: boolean }>(
        db,
        'select * from wedding_by_code($1)',
        [`  ${B.code.toLowerCase()} `]
      )
      expect(w).toEqual({ out_id: B.id, out_partner_a: 'Marta', out_partner_b: 'Pedro', out_registration_open: false })
      expect(await q(db, `select * from wedding_by_code('ZZZZZZ9')`)).toEqual([])
    })

    it('wedding_of_user devuelve el casamiento de la persona', async () => {
      const [w] = await q<{ out_id: string; out_code: string; out_partner_a: string }>(db, 'select * from wedding_of_user($1)', [B.owner])
      expect(w).toMatchObject({ out_id: B.id, out_code: B.code, out_partner_a: 'Marta' })
    })

    it('solo un superadmin de ese casamiento cambia los nombres', async () => {
      const modB = await createUser(db, 'ModB', B.id)
      await q(db, `update users set role = 'admin' where id = $1`, [modB])
      expect((await q<{ out_status: string }>(db, `select * from admin_update_wedding($1, 'Hack', 'Hack')`, [modB]))[0].out_status).toBe('forbidden')
      expect((await q<{ out_status: string }>(db, `select * from admin_update_wedding($1, ' Marta Sol ', 'Pedro')`, [B.owner]))[0].out_status).toBe('ok')
      expect((await q<{ out_status: string }>(db, `select * from admin_update_wedding($1, '', 'Pedro')`, [B.owner]))[0].out_status).toBe('invalid')
      const [w] = await q<{ partner_a: string }>(db, 'select partner_a from weddings where id = $1', [B.id])
      expect(w.partner_a).toBe('Marta Sol')
      expect((await q<{ partner_a: string }>(db, 'select partner_a from weddings where id = $1', [A.id]))[0].partner_a).toBe('Cecilia')
    })
  })

  describe('emails por casamiento', () => {
    it('el mismo email puede estar en dos casamientos, pero no dos veces en uno', async () => {
      await q(db, `insert into users (wedding_id, email) values ($1, 'repetido@x.com'), ($2, 'repetido@x.com')`, [A.id, B.id])
      await expect(q(db, `insert into users (wedding_id, email) values ($1, 'repetido@x.com')`, [A.id])).rejects.toThrow()
      await q(db, `insert into guests (wedding_id, name, email, access_code) values ($1, 'R', 'repetido@x.com', 'SAME1111'), ($2, 'R', 'repetido@x.com', 'SAME1111')`, [A.id, B.id])
      await expect(q(db, `insert into guests (wedding_id, name, email, access_code) values ($1, 'R2', 'repetido@x.com', 'OTRO1111')`, [A.id])).rejects.toThrow()
      await expect(q(db, `insert into guests (wedding_id, name, email, access_code) values ($1, 'R3', 'r3@x.com', 'SAME1111')`, [A.id])).rejects.toThrow()
    })

    it('con varios casamientos un alta sin casamiento falla (no cae en ninguno por defecto)', async () => {
      await expect(q(db, `insert into users (email) values ('huerfano@x.com')`)).rejects.toThrow()
      await expect(q(db, `insert into guests (name, email, access_code) values ('H', 'huerfano@x.com', 'HUER1111')`)).rejects.toThrow()
    })

    it('upsert_user crea la cuenta dentro del casamiento indicado', async () => {
      const [a] = await q<{ out_id: string }>(db, `select * from upsert_user('repetido@x.com', $1)`, [A.id])
      const [b] = await q<{ out_id: string }>(db, `select * from upsert_user('repetido@x.com', $1)`, [B.id])
      expect(a.out_id).not.toBe(b.out_id)
      const [ua] = await q<{ wedding_id: string }>(db, 'select wedding_id from users where id = $1', [a.out_id])
      expect(ua.wedding_id).toBe(A.id)
    })
  })

  describe('login de invitados: el codigo del casamiento manda', () => {
    let anaA: string
    let anaB: string

    beforeAll(async () => {
      await addGuest(A.owner, 'Ana Casamiento A', null, 'ANAA2222')
      await addGuest(B.owner, 'Ana Casamiento B', null, 'ANAA2222') // mismo codigo de invitado: otro casamiento
      anaA = (await search(A.code, 'ana casamiento'))[0].out_id
      anaB = (await search(B.code, 'ana casamiento'))[0].out_id
    })

    it('guest_search con el codigo de A solo encuentra invitados de A', async () => {
      expect((await search(A.code, 'ana casamiento')).map((r) => r.out_name)).toEqual(['Ana Casamiento A'])
      expect((await search(B.code, 'ana casamiento')).map((r) => r.out_name)).toEqual(['Ana Casamiento B'])
      expect(await search('ZZZZZZ', 'ana casamiento')).toEqual([])
    })

    it('el horario de registro es de cada casamiento', async () => {
      await openWindow(A.owner)
      expect((await search(A.code, 'ana casamiento'))[0].out_registration_open).toBe(true)
      expect((await search(B.code, 'ana casamiento'))[0].out_registration_open).toBe(false)
      expect((await q<{ out_open: boolean }>(db, 'select * from registration_status($1)', [A.code]))[0].out_open).toBe(true)
      expect((await q<{ out_open: boolean }>(db, 'select * from registration_status($1)', [B.code]))[0].out_open).toBe(false)
      expect((await q<{ out_open: boolean }>(db, `select * from registration_status('NOEXIS')`))[0].out_open).toBe(false)
    })

    it('con el codigo de A no se registra a un invitado de B', async () => {
      await openWindow(B.owner)
      expect((await register(A.code, anaB)).out_status).toBe('not_found')
      expect((await q<{ claimed_at: Date | null }>(db, 'select claimed_at from guests where id = $1', [anaB]))[0].claimed_at).toBeNull()
    })

    it('registrarse crea la cuenta en el casamiento del invitado', async () => {
      const r = await register(B.code, anaB)
      expect(r.out_status).toBe('ok')
      const [u] = await q<{ wedding_id: string }>(db, 'select wedding_id from users where id = $1', [r.out_id])
      expect(u.wedding_id).toBe(B.id)
    })

    it('con el codigo de A no se puede entrar con el PIN de un invitado de B', async () => {
      expect(await q(db, 'select * from guest_pin_for_login($1, $2)', [anaB, A.code])).toEqual([])
      expect((await q<{ out_status: string }>(db, 'select * from guest_pin_attempt($1, false, $2)', [anaB, A.code]))[0].out_status).toBe('not_found')
      expect((await q<{ pin_failed: number }>(db, 'select pin_failed from guests where id = $1', [anaB]))[0].pin_failed).toBe(0)
      expect(await q(db, 'select * from guest_pin_for_login($1, $2)', [anaB, B.code])).toHaveLength(1)
      expect((await q<{ out_status: string }>(db, 'select * from guest_pin_attempt($1, true, $2)', [anaB, B.code]))[0].out_status).toBe('ok')
      expect(anaA).not.toBe(anaB)
    })
  })

  describe('panel: cada admin solo maneja su casamiento', () => {
    let guestB: string

    beforeAll(async () => {
      guestB = (await addGuest(B.owner, 'Bruno de B', 'bruno@x.com', 'BRUN1111'))!
      await q(db, `select * from upsert_user('bruno@x.com', $1)`, [B.id])
    })

    it('admin_list_guests de A no ve invitados de B', async () => {
      const namesA = (await q<{ guest_name: string }>(db, 'select * from admin_list_guests($1, $2)', [A.owner, 'bruno'])).map((r) => r.guest_name)
      expect(namesA).toEqual([])
      const namesB = (await q<{ guest_name: string }>(db, 'select * from admin_list_guests($1, $2)', [B.owner, 'bruno'])).map((r) => r.guest_name)
      expect(namesB).toEqual(['Bruno de B'])
    })

    it('admin_upsert_guest de A con el email de un invitado de B crea uno nuevo en A (no toca el de B)', async () => {
      const idA = await addGuest(A.owner, 'Bruno de A', 'bruno@x.com', 'BRUN2222')
      expect(idA).not.toBe(guestB)
      const [g] = await q<{ name: string; wedding_id: string }>(db, 'select name, wedding_id from guests where id = $1', [guestB])
      expect(g).toEqual({ name: 'Bruno de B', wedding_id: B.id })
      const [n] = await q<{ wedding_id: string }>(db, 'select wedding_id from guests where id = $1', [idA])
      expect(n.wedding_id).toBe(A.id)
    })

    it('admin_update_guest / admin_delete_guest / admin_revoke_sessions de A no tocan a B', async () => {
      expect(await q(db, `select * from admin_update_guest($1, $2, 'Hack')`, [A.owner, guestB])).toEqual([])
      expect((await q<{ out_status: string }>(db, 'select * from admin_delete_guest($1, $2)', [A.owner, guestB]))[0].out_status).toBe('not_found')
      expect((await q<{ out_status: string }>(db, 'select * from admin_revoke_sessions($1, $2)', [A.owner, guestB]))[0].out_status).toBe('not_found')
      const [g] = await q<{ name: string }>(db, 'select name from guests where id = $1', [guestB])
      expect(g.name).toBe('Bruno de B')
    })

    it('Blanquear contraseña (admin_release_guest): A no puede con B; el dueño de B si', async () => {
      const anaB = (await search(B.code, 'ana casamiento'))[0].out_id
      expect((await q<{ out_status: string }>(db, 'select * from admin_release_guest($1, $2)', [A.owner, anaB]))[0].out_status).toBe('not_found')
      expect(await q(db, 'select * from guest_pin_for_login($1, $2)', [anaB, B.code])).toHaveLength(1)
      expect((await q<{ out_status: string }>(db, 'select * from admin_release_guest($1, $2)', [B.owner, anaB]))[0].out_status).toBe('ok')
      expect(await q(db, 'select * from guest_pin_for_login($1, $2)', [anaB, B.code])).toEqual([])
    })

    it('un admin de B no blanquea al dueño (superadmin) de B', async () => {
      const modB = await createUser(db, 'Mod2B', B.id)
      await q(db, `update users set role = 'admin' where id = $1`, [modB])
      const ownerGuest = await addGuest(B.owner, 'Dueño B', 'marta-pedro@admin.invalid', 'DUEN1111')
      await q(db, `update guests set claimed_at = now() where id = $1`, [ownerGuest])
      expect((await q<{ out_status: string }>(db, 'select * from admin_release_guest($1, $2)', [modB, ownerGuest]))[0].out_status).toBe('forbidden')
    })

    it('el horario del panel es de cada casamiento', async () => {
      const [a] = await q<{ out_key: string; out_opens: Date }>(db, 'select * from admin_get_event_access($1)', [A.owner])
      expect(a.out_key).toBe(A.code)
      await q(db, `select * from admin_set_event_access($1, NULL, now() + interval '1 day', now() + interval '2 days')`, [B.owner])
      const [a2] = await q<{ out_opens: Date }>(db, 'select * from admin_get_event_access($1)', [A.owner])
      expect(a2.out_opens.getTime()).toBe(a.out_opens.getTime())
      const [b] = await q<{ out_key: string; out_joined: number }>(db, 'select * from admin_get_event_access($1)', [B.owner])
      expect(b.out_key).toBe(B.code)
      // cuenta solo a los registrados de B (A tambien tiene registrados)
      const [{ n }] = await q<{ n: number }>(db, 'select count(*)::int as n from guests where wedding_id = $1 and claimed_at is not null', [B.id])
      const [{ all }] = await q<{ all: number }>(db, 'select count(*)::int as all from guests where claimed_at is not null')
      expect(b.out_joined).toBe(n)
      expect(all).toBeGreaterThan(n)
    })

    it('un invitado comun no ve ni cambia el horario; el cierre tiene que ser despues de la apertura', async () => {
      const guest = await createUser(db, 'ComunB', B.id)
      expect(await q(db, 'select * from admin_get_event_access($1)', [guest])).toEqual([])
      expect((await q<{ out_ok: boolean }>(db, `select * from admin_set_event_access($1, NULL, now(), now() + interval '1 hour')`, [guest]))[0].out_ok).toBe(false)
      await expect(q(db, `select * from admin_set_event_access($1, NULL, now() + interval '2 hours', now() + interval '1 hour')`, [B.owner])).rejects.toThrow()
    })

    it('lo que hace un admin queda registrado con su casamiento', async () => {
      const rows = await q<{ wedding_id: string }>(db, `select wedding_id from admin_actions where actor_id = $1`, [B.owner])
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.wedding_id === B.id)).toBe(true)
    })
  })

  describe('create_admin_account', () => {
    it('con varios casamientos hay que decir en cual; con el casamiento la crea ahi', async () => {
      await expect(q(db, `select * from create_admin_account('sin-casamiento', 'h')`)).rejects.toThrow()
      const [r] = await q<{ out_user: string }>(db, `select * from create_admin_account('otro-de-b', 'h', $1)`, [B.id])
      const [u] = await q<{ wedding_id: string }>(db, 'select wedding_id from users where id = $1', [r.out_user])
      expect(u.wedding_id).toBe(B.id)
    })
  })
})
