import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { q } from '../helpers/db'

// La clave publica de Supabase (anon) viaja en el navegador: con ella cualquiera puede llamar por REST a
// cualquier funcion o tabla que anon tenga permitida, sin pasar por las API routes. Supabase le da a anon y
// authenticated permiso sobre TODO lo que se crea en `public`, asi que cada migracion tiene que revocarlo.
// Este test emula esos permisos por defecto y falla si algo quedo expuesto (p. ej. una funcion nueva sin REVOKE).
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  `)
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(dir, file), 'utf8'))
  }
})
afterAll(async () => {
  await db.close()
})

describe('permisos de la clave publica (anon / authenticated)', () => {
  it('ninguna funcion de la app se puede llamar sin pasar por el servidor', async () => {
    // Las funciones de trigger no se pueden llamar por REST: no importan
    const exposed = await q<{ sig: string; role: string }>(
      db,
      `SELECT p.oid::regprocedure::TEXT AS sig, r.role
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
        WHERE n.nspname = 'public'
          AND p.prorettype <> 'trigger'::regtype
          AND has_function_privilege(r.role, p.oid, 'EXECUTE')
        ORDER BY 1, 2`
    )
    expect(exposed, 'Falta REVOKE ... FROM PUBLIC / anon, authenticated en la migracion').toEqual([])
  })

  it('el servidor (service_role) si puede llamar a todas', async () => {
    const missing = await q<{ sig: string }>(
      db,
      `SELECT p.oid::regprocedure::TEXT AS sig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prorettype <> 'trigger'::regtype
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')`
    )
    expect(missing, 'Falta GRANT EXECUTE ... TO service_role').toEqual([])
  })

  it('todas las tablas tienen RLS y ninguna policy (la clave publica no lee ni escribe nada)', async () => {
    const tables = await q<{ name: string; rls: boolean; policies: number }>(
      db,
      `SELECT c.relname AS name, c.relrowsecurity AS rls,
              (SELECT COUNT(*)::INT FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`
    )
    expect(tables.length).toBeGreaterThan(0)
    expect(tables.filter((t) => !t.rls || t.policies > 0)).toEqual([])
  })

  it('no hay vistas (se saltean el RLS de las tablas)', async () => {
    expect(await q(db, `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')`)).toEqual([])
  })
})
