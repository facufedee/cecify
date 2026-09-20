// Base local para desarrollo (LOCAL_DB=1): Postgres embebido (PGlite) que aplica las
// mismas migraciones de supabase/migrations. Datos persistidos en .local-db/.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const globalForDb = globalThis as unknown as { __cecifyLocalDb?: Promise<PGlite> }

const init = async () => {
  const db = new PGlite(path.join(process.cwd(), '.local-db'))
  await db.waitReady

  const { rows } = await db.query<{ exists: boolean }>(
    "select to_regclass('public.guests') is not null as exists"
  )
  if (!rows[0].exists) {
    const dir = path.join(process.cwd(), 'supabase', 'migrations')
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(path.join(dir, file), 'utf8'))
    }
    await db.query(
      `insert into guests (name, email, access_code)
       values ('Invitado de prueba', 'dev@cecify.local', 'DEV12345')`
    )
    console.log('[local-db] creada. Login de prueba: dev@cecify.local / DEV1-2345')
  }
  return db
}

export const getLocalDb = () => (globalForDb.__cecifyLocalDb ??= init())
