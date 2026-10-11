import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')

// Postgres en memoria con TODAS las migraciones del proyecto aplicadas, en orden
export const createDb = async () => {
  const db = new PGlite()
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

export type Db = PGlite

export const q = async <T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows

// Usuario con perfil listo para usar en Descubrir, chat, muro, etc.
// Sin casamiento va al unico que existe (el migrado); con varios casamientos hay que pasarlo.
export const createUser = async (db: Db, name: string, wedding?: string) => {
  const email = `${name.toLowerCase()}@test.local`
  const [u] = wedding
    ? await q<{ id: string }>(db, 'insert into users (wedding_id, email) values ($1, $2) returning id', [wedding, email])
    : await q<{ id: string }>(db, 'insert into users (email) values ($1) returning id', [email])
  await q(
    db,
    `insert into profiles (user_id, name, age, main_photo_url, contact_methods, interests)
     values ($1, $2, 30, $3, $4::jsonb, '["Baile"]'::jsonb)`,
    [u.id, name, `/av-${name}.jpg`, JSON.stringify({ instagram: `ig_${name}` })]
  )
  return u.id
}

// El casamiento al que la migracion paso los datos existentes (Cecilia & Lucas)
export const migratedWedding = async (db: Db) =>
  (await q<{ id: string; code: string }>(db, 'select id, code from weddings order by created_at, id limit 1'))[0]

// Casamiento nuevo con su dueño (superadmin con usuario y contraseña)
export const createWedding = async (db: Db, partnerA: string, partnerB: string, username: string) => {
  const [r] = await q<{ out_status: string; out_wedding: string; out_code: string; out_user: string }>(
    db,
    'select * from create_wedding($1, $2, $3, $4)',
    [partnerA, partnerB, username, 'scrypt$owner']
  )
  if (r.out_status !== 'ok') throw new Error(`create_wedding: ${r.out_status}`)
  return { id: r.out_wedding, code: r.out_code, owner: r.out_user }
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
