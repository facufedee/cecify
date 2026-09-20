import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, createUser, q, wait, type Db } from '../helpers/db'

let db: Db
beforeAll(async () => {
  db = await createDb()
})
afterAll(async () => {
  await db.close()
})

describe('seguridad de la base', () => {
  it('todas las tablas de public tienen RLS activado (la clave publica no lee nada)', async () => {
    const rows = await q<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'`
    )
    expect(rows.length).toBeGreaterThan(10)
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([])
  })

  it('ninguna funcion de la app es ejecutable por PUBLIC (todas hacen REVOKE)', async () => {
    // Si alguien agrega una funcion y olvida el REVOKE, Supabase la expondria con la clave publica.
    const rows = await q<{ proname: string; proacl: string[] | null }>(
      db,
      `select proname, proacl::text[] as proacl from pg_proc
        where pronamespace = 'public'::regnamespace and prokind = 'f'
          and prorettype <> 'trigger'::regtype`
    )
    expect(rows.length).toBeGreaterThan(10)
    const expuestas = rows
      .filter((r) => r.proacl === null || r.proacl.some((a) => a.startsWith('=X') || a.startsWith('=')))
      .map((r) => r.proname)
    expect(expuestas).toEqual([])
  })
})

describe('restricciones', () => {
  it('guests: email en minusculas y codigo en mayusculas', async () => {
    await q(db, `insert into guests (name, email, access_code) values ('Ana','ana@x.com','ABCD2345')`)
    await expect(q(db, `insert into guests (name, email, access_code) values ('X','X@x.com','ZZZZ2345')`)).rejects.toThrow()
    await expect(q(db, `insert into guests (name, email, access_code) values ('Y','y@x.com','abcd2345')`)).rejects.toThrow()
  })

  it('un match por par de usuarios, sin importar el orden, y no consigo mismo', async () => {
    const a = await createUser(db, 'Ari')
    const b = await createUser(db, 'Bea')
    await q(db, 'insert into matches (user1_id, user2_id) values ($1, $2)', [a, b])
    await expect(q(db, 'insert into matches (user1_id, user2_id) values ($1, $2)', [b, a])).rejects.toThrow()
    await expect(q(db, 'insert into matches (user1_id, user2_id) values ($1, $1)', [a])).rejects.toThrow()
  })

  it('updated_at se actualiza solo', async () => {
    const id = await createUser(db, 'Cal')
    const [{ updated_at: antes }] = await q<{ updated_at: Date }>(db, 'select updated_at from users where id = $1', [id])
    await wait(20)
    await q(db, 'update users set email_verified = true where id = $1', [id])
    const [{ updated_at: despues }] = await q<{ updated_at: Date }>(db, 'select updated_at from users where id = $1', [id])
    expect(despues.getTime()).toBeGreaterThan(antes.getTime())
  })
})
