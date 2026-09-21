// Base local para desarrollo (LOCAL_DB=1): Postgres embebido (PGlite) que aplica las
// mismas migraciones de supabase/migrations. Datos persistidos en .local-db/.
import { PGlite } from '@electric-sql/pglite'
import sharp from 'sharp'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const globalForDb = globalThis as unknown as { __cecifyLocalDb?: Promise<PGlite> }

const FIRST_MIGRATION = '20260920160000_initial_schema.sql'

// Invitados demo para ver Discover. Los impares (demo1, demo3, demo5) le dan like de vuelta
// a quien les da like (ver demoLikeBack en lib/db/dev.ts) para poder probar el flujo de match.
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


// Roles y modos de los invitados de prueba (una sola vez). Valentina (demo5) solo usa el muro y
// demo2 es admin, para poder ver ambos casos. dev@ es superadmin.
const ROLES_SEED = 'seed:roles-v1'
const DEMO_MODES: { side: string; lookingFor: string[]; wantsMatch: boolean }[] = [
  { side: 'bride', lookingFor: ['meet', 'dance'], wantsMatch: true },
  { side: 'groom', lookingFor: ['meet'], wantsMatch: true },
  { side: 'bride', lookingFor: ['dance'], wantsMatch: true },
  { side: 'groom', lookingFor: ['meet', 'dance'], wantsMatch: true },
  { side: 'both', lookingFor: [], wantsMatch: false },
  { side: 'groom', lookingFor: ['dance'], wantsMatch: true },
]

const seedRoles = async (db: PGlite) => {
  const done = await db.query('select 1 from _local_migrations where name = $1', [ROLES_SEED])
  if (done.rows.length > 0) return

  for (const [i, m] of DEMO_MODES.entries()) {
    const email = `demo${i + 1}@demo.cecify.local`
    await db.query('update guests set side = $2 where email = $1', [email, m.side])
    await db.query(
      `update profiles set side = $2, wants_match = $3, looking_for = array(select jsonb_array_elements_text($4::jsonb))
        where user_id = (select id from users where email = $1)`,
      [email, m.side, m.wantsMatch, JSON.stringify(m.lookingFor)]
    )
  }
  await db.query(`update users set role = 'admin' where email = 'demo2@demo.cecify.local'`)
  await db.query(
    `insert into users (email, role) values ('dev@cecify.local', 'superadmin')
     on conflict (email) do update set role = 'superadmin'`
  )
  await db.query('insert into _local_migrations (name) values ($1)', [ROLES_SEED])
}

// Fotos de ejemplo para el muro (una sola vez: queda registrado en _local_migrations)
const WALL_SEED = 'seed:wall-v1'
const WALL = [
  { by: 1, caption: 'Llegamos temprano para ver la ceremonia 💍', minutesAgo: 12, likes: [2, 3, 5], size: [1080, 1350], colors: ['#F5EFE0', '#4A7C59'] },
  { by: 3, caption: 'La mesa dulce 😍 no sé por dónde empezar', minutesAgo: 47, likes: [1, 2, 4, 6], size: [1080, 1080], colors: ['#E8B4A0', '#F5EFE0'] },
  { by: 2, caption: 'Atardecer en el jardín', minutesAgo: 3 * 60, likes: [1, 4], size: [1080, 1350], colors: ['#E9A23B', '#7A5C8E'] },
  { by: 4, caption: 'Brindis con los primos 🥂', minutesAgo: 5 * 60, likes: [1, 2, 3, 5, 6], size: [1080, 1080], colors: ['#3F7F7A', '#F3E7CF'] },
  { by: 5, caption: null, minutesAgo: 26 * 60, likes: [3], size: [1080, 1350], colors: ['#A35D6A', '#EFE3CB'] },
  { by: 6, caption: 'Primer baile: 10/10, cero pisotones', minutesAgo: 30 * 60, likes: [1, 2, 3], size: [1080, 1080], colors: ['#6C8FA3', '#F5EFE0'] },
  { by: 1, caption: 'Las flores de la entrada 🌿', minutesAgo: 9 * 24 * 60, likes: [], size: [1080, 1350], colors: ['#4A7C59', '#D9C9A0'] },
]
const WALL_COMMENTS: [number, number, string][] = [
  [0, 3, '¡Qué lindo lugar!'],
  [0, 5, 'Nos vemos en la pista 💃'],
  [1, 1, 'Guardame un poco 🙏'],
  [1, 6, 'La mejor parte de la noche jaja'],
  [3, 2, '¡Salud! 🥂'],
]

const wallPhoto = (i: number, [w, h]: number[], colors: string[]) => {
  let seed = 1234 + i * 977
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const dots = Array.from({ length: 22 }, () => {
    const r = 14 + rnd() * 46
    const fill = rnd() > 0.5 ? '#ffffff' : '#F5EFE0'
    return `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h).toFixed(0)}" r="${r.toFixed(0)}" fill="${fill}" fill-opacity="${(0.18 + rnd() * 0.4).toFixed(2)}"/>`
  }).join('')
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
        </linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#g)"/>${dots}
        <circle cx="${(w * 0.7).toFixed(0)}" cy="${(h * 0.3).toFixed(0)}" r="${(w * 0.13).toFixed(0)}" fill="#ffffff" fill-opacity=".55"/>
      </svg>`
    )
  )
    .jpeg({ quality: 82 })
    .toBuffer()
}

const seedWall = async (db: PGlite) => {
  const done = await db.query('select 1 from _local_migrations where name = $1', [WALL_SEED])
  if (done.rows.length > 0) return

  const dir = path.join(process.cwd(), 'public', 'uploads', 'demo')
  mkdirSync(dir, { recursive: true })
  const userId = async (n: number) =>
    (await db.query<{ id: string }>('select id from users where email = $1', [`demo${n}@demo.cecify.local`])).rows[0].id

  const photoIds: string[] = []
  for (const [i, w] of WALL.entries()) {
    const file = path.join(dir, `wall-${i + 1}.jpg`)
    if (!existsSync(file)) writeFileSync(file, await wallPhoto(i, w.size, w.colors))
    const { rows } = await db.query<{ id: string }>(
      `insert into photos (user_id, photo_url, caption, created_at)
       values ($1, $2, $3, now() - ($4 || ' minutes')::interval) returning id`,
      [await userId(w.by), `/uploads/demo/wall-${i + 1}.jpg`, w.caption, String(w.minutesAgo)]
    )
    photoIds.push(rows[0].id)
    for (const liker of w.likes) {
      await db.query('insert into photo_likes (photo_id, user_id) values ($1, $2)', [rows[0].id, await userId(liker)])
    }
    await db.query('update photos set likes_count = $2 where id = $1', [rows[0].id, w.likes.length])
  }
  for (const [photoIdx, by, text] of WALL_COMMENTS) {
    await db.query('insert into photo_comments (photo_id, user_id, content) values ($1, $2, $3)', [
      photoIds[photoIdx],
      await userId(by),
      text,
    ])
  }
  await db.query('insert into _local_migrations (name) values ($1)', [WALL_SEED])
}

// Historias de ejemplo (una sola vez). Las horas se cuentan desde que se siembra: duran 24 h.
const STORIES_SEED = 'seed:stories-v1'
const STORIES = [
  { by: 2, caption: 'Buen día, jardín ☀️', hoursAgo: 2, colors: ['#6C8FA3', '#F5EFE0'] },
  { by: 2, caption: null, hoursAgo: 0.5, colors: ['#E9A23B', '#7A5C8E'] },
  { by: 3, caption: 'Mi compañero de baile 🐶', hoursAgo: 5, colors: ['#B7684A', '#F0DFC2'] },
  { by: 5, caption: 'Ensayando el primer baile', hoursAgo: 20, colors: ['#3F7F7A', '#F3E7CF'] },
]

const storyPhoto = (i: number, colors: string[]) => {
  let seed = 777 + i * 1013
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const dots = Array.from({ length: 26 }, () => {
    const r = 16 + rnd() * 60
    return `<circle cx="${(rnd() * 720).toFixed(0)}" cy="${(rnd() * 1280).toFixed(0)}" r="${r.toFixed(0)}" fill="#fff" fill-opacity="${(0.15 + rnd() * 0.35).toFixed(2)}"/>`
  }).join('')
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280">
        <defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
        </linearGradient></defs>
        <rect width="720" height="1280" fill="url(#g)"/>${dots}
        <circle cx="360" cy="520" r="140" fill="#fff" fill-opacity=".5"/>
      </svg>`
    )
  )
    .jpeg({ quality: 82 })
    .toBuffer()
}

const seedStories = async (db: PGlite) => {
  const done = await db.query('select 1 from _local_migrations where name = $1', [STORIES_SEED])
  if (done.rows.length > 0) return

  const dir = path.join(process.cwd(), 'public', 'uploads', 'demo')
  mkdirSync(dir, { recursive: true })
  const userId = async (n: number) =>
    (await db.query<{ id: string }>('select id from users where email = $1', [`demo${n}@demo.cecify.local`])).rows[0].id

  const ids: string[] = []
  for (const [i, st] of STORIES.entries()) {
    const file = path.join(dir, `story-${i + 1}.jpg`)
    if (!existsSync(file)) writeFileSync(file, await storyPhoto(i, st.colors))
    const { rows } = await db.query<{ id: string }>(
      `insert into stories (user_id, photo_url, caption, created_at, expires_at)
       values ($1, $2, $3, now() - ($4 || ' minutes')::interval, now() - ($4 || ' minutes')::interval + interval '24 hours')
       returning id`,
      [await userId(st.by), `/uploads/demo/story-${i + 1}.jpg`, st.caption, String(Math.round(st.hoursAgo * 60))]
    )
    ids.push(rows[0].id)
  }
  // Lucia ya vio la de Camila (para ver un anillo "visto" en esa cuenta)
  await db.query('insert into story_views (story_id, viewer_id) values ($1, $2)', [ids[2], await userId(1)])
  await db.query('insert into _local_migrations (name) values ($1)', [STORIES_SEED])
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
  await seedRoles(db)
  await seedWall(db)
  await seedStories(db)
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

// Se vuelve a preparar si aparecen migraciones nuevas (sin reiniciar el servidor). Una migracion ya
// aplicada que se edita NO se reaplica: en ese caso borrar .local-db/.
const migrationsSignature = () =>
  readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .join('|')

let prepared: Promise<PGlite> | undefined
let signature = ''
export const getLocalDb = () => {
  const current = migrationsSignature()
  if (!prepared || current !== signature) {
    signature = current
    prepared = open().then(prepare)
  }
  return prepared
}
