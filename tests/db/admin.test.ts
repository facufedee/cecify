import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, type Db } from '../helpers/db'

let db: Db
let root: string // superadmin
let mod: string // admin
let ana: string
let bob: string
let cai: string

const call = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => q<T>(db, sql, params)

beforeAll(async () => {
  db = await createDb()
  ;[root, mod, ana, bob, cai] = [
    await createUser(db, 'Root'),
    await createUser(db, 'Mod'),
    await createUser(db, 'Ana'),
    await createUser(db, 'Bob'),
    await createUser(db, 'Cai'),
  ]
  await q(db, `update users set role = 'superadmin' where id = $1`, [root])
  await q(db, `update users set role = 'admin' where id = $1`, [mod])
  // Los createUser usan ana@test.local etc.: los damos de alta como invitados
  for (const [name, code] of [['Ana', 'ANAA1111'], ['Bob', 'BOBB2222'], ['Cai', 'CAII3333']]) {
    await q(db, `insert into guests (name, email, access_code) values ($1, $2, $3)`, [
      name,
      `${name.toLowerCase()}@test.local`,
      code,
    ])
  }
})
afterAll(async () => {
  await db.close()
})

describe('permisos: un invitado comun no ve ni cambia nada', () => {
  // Datos temporales para que cada lectura tenga algo que devolver
  beforeAll(async () => {
    await call(`insert into reports (reporter_id, reported_user_id, type, reason) values ($1, $2, 'profile', 'spam')`, [bob, cai])
    await call(`insert into photos (user_id, photo_url) values ($1, '/tmp.jpg')`, [bob])
    await call(`insert into stories (user_id, photo_url) values ($1, '/tmp-s.jpg')`, [bob])
    await call(`select admin_log($1, 'test', 'x', NULL)`, [root])
  })
  afterAll(async () => {
    await call('delete from reports')
    await call('delete from photos')
    await call('delete from stories')
    await call('delete from admin_actions')
  })

  const reads: [string, unknown[]][] = [
    ['admin_stats($1)', []],
    ['admin_list_guests($1)', []],
    ['admin_list_reports($1)', []],
    ['admin_list_photos($1)', []],
    ['admin_list_stories($1)', []],
    ['admin_recent_actions($1)', []],
  ]

  it('is_admin distingue los roles', async () => {
    const is = async (id: string) => (await call<{ is_admin: boolean }>('select is_admin($1)', [id]))[0].is_admin
    expect(await is(root)).toBe(true)
    expect(await is(mod)).toBe(true)
    expect(await is(ana)).toBe(false)
    expect(await is('00000000-0000-0000-0000-000000000000')).toBe(false)
  })

  it.each(reads)('%s no devuelve filas a un invitado y si a un admin', async (fn, extra) => {
    // datos para que haya algo que devolver
    expect(await call(`select * from ${fn}`, [ana, ...extra])).toHaveLength(0)
    expect((await call(`select * from ${fn}`, [mod, ...extra])).length).toBeGreaterThan(0)
  })

  it('las acciones de escritura no hacen nada sin permiso', async () => {
    const [{ id: report }] = await call<{ id: string }>(
      `insert into reports (reporter_id, reported_user_id, type, reason) values ($1, $2, 'profile', 'spam') returning id`,
      [ana, bob]
    )
    const [{ id: photo }] = await call<{ id: string }>(
      `insert into photos (user_id, photo_url) values ($1, '/p.jpg') returning id`,
      [bob]
    )
    const [{ id: guest }] = await call<{ id: string }>(`select id from guests where email = 'bob@test.local'`)

    expect(await call('select * from admin_upsert_guest($1, $2, $3, $4)', [ana, 'Z', 'z@x.com', 'ZZZZ2345'])).toHaveLength(0)
    expect(await call(`select * from admin_update_guest($1, $2, 'Hack')`, [ana, guest])).toHaveLength(0)
    expect((await call<{ out_status: string }>('select * from admin_delete_guest($1, $2)', [ana, guest]))[0].out_status).toBe('forbidden')
    expect((await call<{ out_ok: boolean }>(`select * from admin_set_report_status($1, $2, 'dismissed')`, [ana, report]))[0].out_ok).toBe(false)
    expect(await call('select * from admin_delete_photo($1, $2)', [ana, photo])).toHaveLength(0)

    expect(await call('select 1 from guests where email = $1', ['z@x.com'])).toHaveLength(0)
    expect(await call(`select 1 from guests where id = $1 and name = 'Bob'`, [guest])).toHaveLength(1)
    expect(await call(`select 1 from reports where id = $1 and status = 'open'`, [report])).toHaveLength(1)
    expect(await call('select 1 from photos where id = $1', [photo])).toHaveLength(1)
  })
})

describe('invitados', () => {
  it('lista con si ya entraron y si tienen perfil, y busca por nombre o email', async () => {
    await call(`insert into guests (name, email, access_code) values ('Nadia Nueva', 'nadia@x.com', 'NADI4444')`)
    const rows = await call<{ guest_name: string; user_id: string | null; has_profile: boolean; total_count: string }>(
      'select * from admin_list_guests($1)',
      [mod]
    )
    expect(rows.map((r) => r.guest_name)).toEqual(['Ana', 'Bob', 'Cai', 'Nadia Nueva'])
    expect(rows.find((r) => r.guest_name === 'Ana')).toMatchObject({ has_profile: true })
    expect(rows.find((r) => r.guest_name === 'Nadia Nueva')).toMatchObject({ user_id: null, has_profile: false })
    expect(Number(rows[0].total_count)).toBe(4)

    const search = async (s: string, limit = 50) =>
      (await call<{ guest_name: string }>('select * from admin_list_guests($1, $2, $3)', [mod, s, limit])).map((r) => r.guest_name)
    expect(await search('nad')).toEqual(['Nadia Nueva'])
    expect(await search('BOB@TEST')).toEqual(['Bob'])
    expect(await search('%')).toEqual([]) // los comodines no se interpretan
    expect(await search('', 2)).toHaveLength(2)
  })

  it('alta: normaliza email y codigo; un email que ya existe conserva su codigo', async () => {
    const [a] = await call<{ out_id: string; out_code: string; out_created: boolean }>(
      `select * from admin_upsert_guest($1, ' Lu Nuevo ', ' LU@X.COM ', 'ab-cd 2345', 'bride')`,
      [mod]
    )
    expect(a).toMatchObject({ out_code: 'ABCD2345', out_created: true })
    const [g] = await call<{ name: string; email: string; side: string }>('select * from guests where id = $1', [a.out_id])
    expect(g).toMatchObject({ name: 'Lu Nuevo', email: 'lu@x.com', side: 'bride' })

    // mismo email, otro codigo generado: se conserva el original y se actualiza el nombre
    const [b] = await call<{ out_code: string; out_created: boolean }>(
      `select * from admin_upsert_guest($1, 'Lu Renombrado', 'lu@x.com', 'ZZZZ9999')`,
      [mod]
    )
    expect(b).toMatchObject({ out_code: 'ABCD2345', out_created: false })
    const [h] = await call<{ name: string; side: string }>('select name, side from guests where id = $1', [a.out_id])
    expect(h).toMatchObject({ name: 'Lu Renombrado', side: 'bride' }) // side NULL = no cambiar

    // replace_code pisa el codigo; side '' lo quita
    const [c] = await call<{ out_code: string }>(
      `select * from admin_upsert_guest($1, 'Lu Renombrado', 'lu@x.com', 'ZZZZ9999', '', true)`,
      [mod]
    )
    expect(c.out_code).toBe('ZZZZ9999')
    expect((await call<{ side: string | null }>('select side from guests where id = $1', [a.out_id]))[0].side).toBeNull()
  })

  it('rechaza codigos repetidos, lados invalidos y emails en mayuscula guardados a mano', async () => {
    await expect(call(`select * from admin_upsert_guest($1, 'X', 'x1@x.com', 'ZZZZ9999')`, [mod])).rejects.toThrow()
    await expect(call(`select * from admin_upsert_guest($1, 'X', 'x2@x.com', 'QQQQ1111', 'otro')`, [mod])).rejects.toThrow(/lado/i)
  })

  it('edicion por id: nombre, lado y codigo nuevo; lo que no se pasa no cambia', async () => {
    const [{ id }] = await call<{ id: string }>(`select id from guests where email = 'ana@test.local'`)
    const [r1] = await call<{ out_code: string }>(`select * from admin_update_guest($1, $2, 'Ana María', 'both')`, [mod, id])
    expect(r1.out_code).toBe('ANAA1111')
    expect((await call('select name, side from guests where id = $1', [id]))[0]).toMatchObject({ name: 'Ana María', side: 'both' })

    const [r2] = await call<{ out_code: string }>(`select * from admin_update_guest($1, $2, NULL, NULL, 'nuev-o 5555')`, [mod, id])
    expect(r2.out_code).toBe('NUEVO5555')
    expect((await call('select name, side from guests where id = $1', [id]))[0]).toMatchObject({ name: 'Ana María', side: 'both' })

    await call(`select * from admin_update_guest($1, $2, NULL, '')`, [mod, id])
    expect((await call<{ side: string | null }>('select side from guests where id = $1', [id]))[0].side).toBeNull()
    expect(await call(`select * from admin_update_guest($1, '00000000-0000-0000-0000-000000000000', 'X')`, [mod])).toHaveLength(0)
  })

  it('eliminar un invitado borra su cuenta y todo lo suyo; no deja borrar a un admin', async () => {
    const [{ id: guest }] = await call<{ id: string }>(`select id from guests where email = 'cai@test.local'`)
    await call(`insert into photos (user_id, photo_url) values ($1, '/c.jpg')`, [cai])
    await call('insert into matches (user1_id, user2_id) values (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))', [cai, bob])
    await call(
      `insert into conversations (match_id, user1_id, user2_id) select id, user1_id, user2_id from matches where $1 in (user1_id, user2_id)`,
      [cai]
    )

    const del = async (actor: string, id: string) =>
      (await call<{ out_status: string }>('select * from admin_delete_guest($1, $2)', [actor, id]))[0].out_status

    expect(await del(mod, guest)).toBe('ok')
    expect(await call('select 1 from guests where id = $1', [guest])).toHaveLength(0)
    expect(await call('select 1 from users where id = $1', [cai])).toHaveLength(0)
    expect(await call('select 1 from profiles where user_id = $1', [cai])).toHaveLength(0)
    expect(await call('select 1 from photos where user_id = $1', [cai])).toHaveLength(0)
    expect(await call('select 1 from matches')).toHaveLength(0)
    expect(await del(mod, guest)).toBe('not_found')

    // un admin tiene rol: primero hay que quitarselo
    const dana = await createUser(db, 'Dana')
    await call(`update users set role = 'admin' where id = $1`, [dana])
    await call(`insert into guests (name, email, access_code) values ('Dana', 'dana@test.local', 'DANA5555')`)
    const [{ id: danaGuest }] = await call<{ id: string }>(`select id from guests where email = 'dana@test.local'`)
    expect(await del(root, danaGuest)).toBe('has_role')
    expect(await call('select 1 from users where id = $1', [dana])).toHaveLength(1)
    await call(`update users set role = 'guest' where id = $1`, [dana])
    expect(await del(root, danaGuest)).toBe('ok')
    expect(await call('select 1 from users where id = $1', [dana])).toHaveLength(0)
  })
})

describe('reportes', () => {
  let r1: string
  let r2: string

  it('lista con nombres, cantidad de reportes al mismo invitado y filtra por estado', async () => {
    // Mod ya no es invitado comun: usamos a Ana como reportada y a Bob como quien reporta
    ;[{ id: r1 }] = await call<{ id: string }>(
      `insert into reports (reporter_id, reported_user_id, type, reason, details, context)
       values ($1, $2, 'chat', 'harassment', 'me insulta', '{"messages":[{"from":"reportado","content":"hola"}]}') returning id`,
      [bob, ana]
    )
    ;[{ id: r2 }] = await call<{ id: string }>(
      `insert into reports (reporter_id, reported_user_id, type, reason) values ($1, $2, 'profile', 'fake') returning id`,
      [root, ana]
    )

    const rows = await call<Record<string, unknown>>('select * from admin_list_reports($1)', [mod])
    expect(rows).toHaveLength(2)
    const chat = rows.find((r) => r.report_id === r1)!
    expect(chat).toMatchObject({
      report_type: 'chat',
      reason: 'harassment',
      details: 'me insulta',
      status: 'open',
      reporter_name: 'Bob',
      reported_name: 'Ana',
      reports_against: 2,
      open_against: 2,
    })
    expect(chat.context).toMatchObject({ messages: [{ content: 'hola' }] })
    expect(await call('select * from admin_list_reports($1, $2)', [mod, 'reviewed'])).toHaveLength(0)
  })

  it('cambiar el estado guarda la fecha de revision, actualiza los contadores y queda registrado', async () => {
    const set = async (id: string, s: string) =>
      (await call<{ out_ok: boolean }>('select * from admin_set_report_status($1, $2, $3)', [mod, id, s]))[0].out_ok

    expect(await set(r1, 'reviewed')).toBe(true)
    const [row] = await call<{ status: string; reviewed_at: Date | null; open_against: number }>(
      'select * from admin_list_reports($1, $2)',
      [mod, 'reviewed']
    )
    expect(row).toMatchObject({ status: 'reviewed', open_against: 1 })
    expect(row.reviewed_at).not.toBeNull()

    expect(await set(r1, 'open')).toBe(true) // se puede reabrir
    expect((await call<{ reviewed_at: Date | null }>('select reviewed_at from reports where id = $1', [r1]))[0].reviewed_at).toBeNull()

    expect(await set(r2, 'dismissed')).toBe(true)
    expect(await set(r2, 'borrado')).toBe(false)
    expect(await set('00000000-0000-0000-0000-000000000000', 'reviewed')).toBe(false)
    expect(await call('select * from admin_list_reports($1, $2)', [mod, 'open'])).toHaveLength(1)
  })

  it('no se pierde la copia de lo reportado aunque se borre el original', async () => {
    const [{ id: photo }] = await call<{ id: string }>(`insert into photos (user_id, photo_url) values ($1, '/o.jpg') returning id`, [ana])
    const [{ id: rep }] = await call<{ id: string }>(
      `insert into reports (reporter_id, reported_user_id, type, target_id, reason, context)
       values ($1, $2, 'photo', $3, 'inappropriate', '{"photoUrl":"/o.jpg"}') returning id`,
      [bob, ana, photo]
    )
    await call('select * from admin_delete_photo($1, $2)', [mod, photo])
    const row = (await call<{ report_id: string; context: unknown }>('select * from admin_list_reports($1)', [mod])).find((r) => r.report_id === rep)
    expect(row?.context).toEqual({ photoUrl: '/o.jpg' })
  })
})

describe('moderacion de contenido', () => {
  it('el admin ve las fotos de todos, incluso de quien alguien bloqueo, y con sus comentarios', async () => {
    await call('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [bob, ana])
    const [{ id: photo }] = await call<{ id: string }>(
      `insert into photos (user_id, photo_url, caption) values ($1, '/x.jpg', 'hola') returning id`,
      [ana]
    )
    await call(`insert into photo_comments (photo_id, user_id, content) values ($1, $2, 'primero')`, [photo, bob])

    // Bob no la ve en su muro, pero el admin si
    expect((await call('select * from list_photos($1)', [bob])).map((r) => r.photo_id)).not.toContain(photo)
    const list = await call<{ photo_id: string; comments_count: number; author_name: string }>('select * from admin_list_photos($1)', [mod])
    expect(list.find((p) => p.photo_id === photo)).toMatchObject({ author_name: 'Ana', comments_count: 1 })
    expect((await call<{ body: string }>('select * from admin_list_comments($1, $2)', [mod, photo]))[0].body).toBe('primero')
  })

  it('borrar un comentario, una foto (con todo lo suyo) y una historia; el borrado queda registrado', async () => {
    const [{ id: photo }] = await call<{ id: string }>(
      `insert into photos (user_id, photo_url) values ($1, '/y.jpg') returning id`,
      [ana]
    )
    const [{ id: comment }] = await call<{ id: string }>(
      `insert into photo_comments (photo_id, user_id, content) values ($1, $2, 'feo') returning id`,
      [photo, bob]
    )
    await call('insert into photo_likes (photo_id, user_id) values ($1, $2)', [photo, bob])

    expect(await call('select * from admin_delete_comment($1, $2)', [mod, comment])).toHaveLength(1)
    expect(await call('select * from admin_delete_comment($1, $2)', [mod, comment])).toHaveLength(0)
    expect(await call('select 1 from photo_comments where photo_id = $1', [photo])).toHaveLength(0)

    const [del] = await call<{ out_url: string }>('select * from admin_delete_photo($1, $2)', [mod, photo])
    expect(del.out_url).toBe('/y.jpg')
    expect(await call('select 1 from photo_likes where photo_id = $1', [photo])).toHaveLength(0)
    expect(await call('select * from admin_delete_photo($1, $2)', [mod, photo])).toHaveLength(0)

    const [{ id: story }] = await call<{ id: string }>(
      `insert into stories (user_id, photo_url) values ($1, '/s.jpg') returning id`,
      [ana]
    )
    expect((await call<{ views_count: number }>('select * from admin_list_stories($1)', [mod])).length).toBe(1)
    expect((await call<{ out_url: string }>('select * from admin_delete_story($1, $2)', [mod, story]))[0].out_url).toBe('/s.jpg')
    expect(await call('select * from admin_list_stories($1)', [mod])).toHaveLength(0)

    const actions = (await call<{ action: string; actor_name: string }>('select * from admin_recent_actions($1)', [mod])).map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(['comment_delete', 'photo_delete', 'story_delete']))
  })

  it('las historias vencidas no aparecen', async () => {
    await call(`insert into stories (user_id, photo_url, expires_at) values ($1, '/old.jpg', NOW() - INTERVAL '1 hour')`, [ana])
    expect(await call('select * from admin_list_stories($1)', [mod])).toHaveLength(0)
  })
})

describe('metricas y registro', () => {
  it('cuenta lo que hay', async () => {
    await call(`update profiles set wants_match = false, side = 'groom' where user_id = $1`, [ana])
    const [s] = await call<Record<string, number>>('select * from admin_stats($1)', [mod])
    expect(s.profiles_total).toBe(4)
    expect(s.only_wall).toBe(1)
    expect(s.wants_match).toBe(3)
    expect(s.side_groom).toBe(1)
    expect(s.side_unset).toBe(3)
    expect(s.guests_total).toBeGreaterThan(0)
    expect(s.reports_open).toBe(2) // el chat reabierto y el de la foto
    expect(s.blocks_total).toBe(1)
    expect(s.stories_active).toBe(0)
  })

  it('el cambio de rol tambien queda en el registro, con quien lo hizo', async () => {
    await call(`select * from set_user_role($1, $2, 'admin')`, [root, ana])
    const [a] = await call<{ action: string; actor_name: string; details: { to: string } }>(
      `select * from admin_recent_actions($1) where action = 'set_role'`,
      [mod]
    )
    expect(a).toMatchObject({ actor_name: 'Root', details: { to: 'admin' } })
  })

  it('el registro sobrevive si se borra la cuenta de quien actuo', async () => {
    const tmp = await createUser(db, 'Tmp')
    await call(`update users set role = 'admin' where id = $1`, [tmp])
    await call(`select * from admin_set_report_status($1, $2, 'reviewed')`, [tmp, (await call<{ id: string }>('select id from reports limit 1'))[0].id])
    await call('delete from users where id = $1', [tmp])
    const names = (await call<{ actor_name: string }>('select * from admin_recent_actions($1)', [mod])).map((r) => r.actor_name)
    expect(names).toContain('Cuenta eliminada')
  })
})
