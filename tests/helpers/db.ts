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
export const createUser = async (db: Db, name: string) => {
  const [u] = await q<{ id: string }>(db, 'insert into users (email) values ($1) returning id', [
    `${name.toLowerCase()}@test.local`,
  ])
  await q(
    db,
    `insert into profiles (user_id, name, age, main_photo_url, contact_methods, interests)
     values ($1, $2, 30, $3, $4::jsonb, '["Baile"]'::jsonb)`,
    [u.id, name, `/av-${name}.jpg`, JSON.stringify({ instagram: `ig_${name}` })]
  )
  return u.id
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
