// Base local para desarrollo (LOCAL_DB=1): Postgres embebido (PGlite) que aplica las
// mismas migraciones de supabase/migrations. Datos persistidos en .local-db/.
import { PGlite } from '@electric-sql/pglite'
import sharp from 'sharp'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const globalForDb = globalThis as unknown as { __cecifyLocalDb?: Promise<PGlite> }

const FIRST_MIGRATION = '20260920160000_initial_schema.sql'

// Invitados demo para ver Discover. Los impares (demo1, demo3, demo5) le dan like de vuelta
// a quien les da like (ver recordSwipe en lib/db.ts) para poder probar el flujo de match.
const DEMOS = [
  { name: 'Lucía', age: 28, bio: 'Bailo hasta que apagan la música.', interests: ['Baile', 'Música', 'Viajes', 'Vino'], colors: ['#4A7C59', '#D9C9A0'] },
  { name: 'Mateo', age: 32, bio: 'Fotógrafo aficionado, cazador de atardeceres.', interests: ['Fotografía', 'Naturaleza', 'Viajes'], colors: ['#6C8FA3', '#F5EFE0'] },
  { name: 'Camila', age: 26, bio: 'Perro primero, después todo lo demás.', interests: ['Mascotas', 'Cine y series', 'Gastronomía'], colors: ['#B7684A', '#F0DFC2'] },
  { name: 'Joaquín', age: 35, bio: 'Asador oficial de la familia.', interests: ['Gastronomía', 'Vino', 'Deportes', 'Música'], colors: ['#7A5C8E', '#E8D9C4'] },
  { name: 'Valentina', age: 30, bio: 'Idiomas, libros y mate.', interests: ['Lectura', 'Idiomas', 'Arte'], colors: ['#3F7F7A', '#F3E7CF'] },
  { name: 'Tomás', age: 29, bio: 'Gamer de día, bailarín de casamientos.', interests: ['Gaming', 'Tecnología', 'Baile', 'Fitness'], colors: ['#A35D6A', '#EFE3CB'] },
]

const demoPhoto = (colors: string[]) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
        </linearGradient></defs>
        <rect width="900" height="1200" fill="url(#g)"/>
        <circle cx="450" cy="470" r="170" fill="rgba(255,255,255,.82)"/>
        <path d="M130 1200 Q150 780 450 780 Q750 780 770 1200 Z" fill="rgba(255,255,255,.82)"/>
      </svg>`
    )
  )
    .jpeg({ quality: 82 })
    .toBuffer()

const seedDemos = async (db: PGlite) => {
  const dir = path.join(process.cwd(), 'public', 'uploads', 'demo')
  mkdirSync(dir, { recursive: true })

  for (const [i, d] of DEMOS.entries()) {
    const n = i + 1
    const email = `demo${n}@demo.cecify.local`
    const file = path.join(dir, `demo-${n}.jpg`)
    if (!existsSync(file)) {
      writeFileSync(file, await demoPhoto(d.colors))
    }

    await db.query(
      `insert into guests (name, email, access_code) values ($1, $2, $3) on conflict do nothing`,
      [d.name, email, `DEMO000${n}`]
    )
    const u = await db.query<{ id: string }>(
      `insert into users (email) values ($1)
       on conflict (email) do update set email = excluded.email returning id`,
      [email]
    )
    await db.query(
      `insert into profiles (user_id, name, age, bio, main_photo_url, additional_photos, interests, contact_methods)
       values ($1, $2, $3, $4, $5, '[]'::jsonb, $6::jsonb, $7::jsonb)
       on conflict (user_id) do nothing`,
      [
        u.rows[0].id,
        d.name,
        d.age,
        d.bio,
        `/uploads/demo/demo-${n}.jpg`,
        JSON.stringify(d.interests),
        JSON.stringify({ instagram: `demo_${n}` }),
      ]
    )
  }
}

// Idempotente: se re-ejecuta tras cada recarga del modulo (HMR) sobre la misma conexion
const prepare = async (db: PGlite) => {
  await db.exec('create table if not exists _local_migrations (name text primary key)')
  const applied = new Set(
    (await db.query<{ name: string }>('select name from _local_migrations')).rows.map((r) => r.name)
  )

  // Bases creadas antes de existir el registro: la migracion inicial ya estaba aplicada
  if (applied.size === 0) {
    const { rows } = await db.query<{ exists: boolean }>(
      "select to_regclass('public.guests') is not null as exists"
    )
    if (rows[0].exists) {
      await db.query('insert into _local_migrations (name) values ($1)', [FIRST_MIGRATION])
      applied.add(FIRST_MIGRATION)
    }
  }

  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    await db.exec(readFileSync(path.join(dir, file), 'utf8'))
    await db.query('insert into _local_migrations (name) values ($1)', [file])
    console.log(`[local-db] migracion aplicada: ${file}`)
  }

  await db.query(
    `insert into guests (name, email, access_code)
     values ('Invitado de prueba', 'dev@cecify.local', 'DEV12345')
     on conflict do nothing`
  )
  await seedDemos(db)
  return db
}

// La conexion PGlite se comparte entre recargas (no se puede abrir dos veces la misma carpeta);
// `prepared` vive en el modulo, asi que migraciones nuevas se aplican sin reiniciar el servidor.
const open = () =>
  (globalForDb.__cecifyLocalDb ??= (async () => {
    const db = new PGlite(path.join(process.cwd(), '.local-db'))
    await db.waitReady
    return db
  })())

let prepared: Promise<PGlite> | undefined
export const getLocalDb = () => (prepared ??= open().then(prepare))
