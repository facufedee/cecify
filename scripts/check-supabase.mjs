// Uso: npm run check:supabase
// Revisa que un proyecto de Supabase este listo para la app: variables, migraciones aplicadas, bucket de fotos,
// que la clave publica NO pueda leer ni llamar nada, y que haya una cuenta de organizador.
// Solo lee: no crea ni cambia nada. Toma las variables de .env.local (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para probar la clave publica).
import { createClient } from '@supabase/supabase-js'

const env = process.env
const NIL = '00000000-0000-0000-0000-000000000000'
let failed = 0
let warned = 0
const ok = (msg) => console.log(`  ✔ ${msg}`)
const bad = (msg, hint) => {
  failed++
  console.log(`  ✘ ${msg}${hint ? `\n      → ${hint}` : ''}`)
}
const warn = (msg, hint) => {
  warned++
  console.log(`  ! ${msg}${hint ? `\n      → ${hint}` : ''}`)
}
const section = (title) => console.log(`\n${title}`)

// ---- Variables ----
section('Variables de entorno')
const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim()
// Igual que la app (lib/supabase.ts): sin el /rest/v1 que a veces se pega de mas
const url = rawUrl?.replace(new RegExp('/rest/v1/?$'), '').replace(new RegExp('/+$'), '')
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (env.LOCAL_DB === '1') warn('LOCAL_DB=1: la app usa la base local, no Supabase', 'Para probar contra Supabase, comentá LOCAL_DB en .env.local')
if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  bad('NEXT_PUBLIC_SUPABASE_URL falta o no parece una URL de Supabase', 'Supabase → Project Settings → Data API → Project URL')
} else if (rawUrl !== url) {
  warn('NEXT_PUBLIC_SUPABASE_URL tiene algo de mas al final (p. ej. /rest/v1/)', `La app lo tolera, pero dejala como ${url} (tambien en Vercel)`)
} else ok('NEXT_PUBLIC_SUPABASE_URL')
if (!serviceKey) bad('Falta SUPABASE_SERVICE_ROLE_KEY', 'Supabase → Project Settings → API Keys → service_role / secret (NUNCA en una variable NEXT_PUBLIC_)')
else ok('SUPABASE_SERVICE_ROLE_KEY')
if (!publicKey) warn('Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: no se puede probar que la clave publica este cerrada', 'La app no la usa; solo sirve para este chequeo')
if (!env.JWT_SECRET) bad('Falta JWT_SECRET', 'Generalo con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
else if (env.JWT_SECRET.length < 32) bad('JWT_SECRET tiene menos de 32 caracteres (en produccion la app no arranca)')
else ok('JWT_SECRET')
if (Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) !== Boolean(env.TURNSTILE_SECRET_KEY)) {
  bad('Turnstile: tienen que estar las dos claves (NEXT_PUBLIC_TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY) o ninguna')
} else if (!env.TURNSTILE_SECRET_KEY) warn('Sin captcha (TURNSTILE_*): la entrada con el QR y el login de organizadores no lo piden')
else if (env.TURNSTILE_SECRET_KEY.startsWith('1x0000')) warn('Turnstile con las claves de PRUEBA de Cloudflare (siempre aprueban)', 'En produccion cargá las reales')
else ok('Captcha (Turnstile)')
const vapid = [env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].filter(Boolean).length
if (vapid === 0) warn('Sin notificaciones push (VAPID_*): la app anda igual')
else if (vapid < 3) bad('Push: faltan variables VAPID (van las tres o ninguna)')
else ok('Notificaciones push (VAPID)')

if (!url || !serviceKey) {
  console.log('\nSin URL y service role no se puede revisar el proyecto.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

// ---- Migraciones ----
// Una funcion o columna de cada etapa: si falta, esa migracion (o una anterior) no se aplico
section('Migraciones (supabase/migrations)')
const notFound = (e) => e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message))
const fnChecks = [
  ['find_guest', { p_email: '', p_code: '' }, 'login e invitados'],
  ['get_session_info', { p_user: NIL }, 'sesiones'],
  ['discover_profiles', { p_user: NIL }, 'descubrir'],
  ['admin_list_guests', { p_actor: NIL }, 'panel de administracion'],
  ['admin_get_event_access', { p_actor: NIL }, 'QR de la fiesta'],
  ['admin_account_of', { p_user: NIL }, 'cuentas de organizador'],
  ['redeem_session_transfer', { p_hash: 'chequeo' }, 'pasar la sesion a la app instalada'],
]
let schemaOk = true
for (const [fn, args, what] of fnChecks) {
  const { error } = await admin.rpc(fn, args)
  if (notFound(error)) {
    schemaOk = false
    bad(`No existe ${fn} (${what})`)
  } else if (error) {
    schemaOk = false
    bad(`${fn} (${what}) respondio con error: ${error.message}`)
  } else ok(`${fn} (${what})`)
}
for (const [table, cols, what] of [
  ['profiles', 'gender, interested_in, pref_age_min, pref_age_max', 'preferencias de match'],
  ['event_access', 'id', 'QR de la fiesta'],
  ['admin_accounts', 'user_id', 'cuentas de organizador'],
]) {
  const { error } = await admin.from(table).select(cols).limit(1)
  if (error) {
    schemaOk = false
    bad(`Falta la tabla o columnas de ${what} (${table}): ${error.message}`)
  } else ok(`tabla ${table} (${what})`)
}
if (!schemaOk) console.log('      → Aplicá las migraciones: npx supabase link --project-ref <ref> y despues npx supabase db push')

// ---- Storage ----
section('Fotos (storage)')
const { data: bucket, error: bucketError } = await admin.storage.getBucket('profile-photos')
if (bucketError || !bucket) bad('No existe el bucket profile-photos', 'Lo crea la primera migracion: aplicá las migraciones')
else if (!bucket.public) bad('El bucket profile-photos no es publico (las fotos no se van a ver)')
else ok('bucket profile-photos (publico)')

// ---- Clave publica ----
section('Clave publica (la que podria tener cualquiera)')
if (publicKey) {
  const anon = createClient(url, publicKey, { auth: { persistSession: false } })
  // Solo cuenta como cerrado lo que Supabase responde de verdad: 0 filas por RLS o permiso denegado.
  // Cualquier otro error (URL mal, sin conexion) no prueba nada.
  const denied = (e) => e && (e.code === '42501' || /permission denied/i.test(e.message))
  const unproven = (what, e) => warn(`No se pudo probar ${what}: ${e.message}`)
  for (const table of ['users', 'guests', 'profiles', 'messages', 'admin_accounts', 'event_access']) {
    const { data, error } = await anon.from(table).select('*').limit(1)
    if (!error && data?.length > 0) bad(`La clave publica LEE la tabla ${table}`, 'Revisá RLS: todas las tablas tienen que tener RLS sin policies')
    else if (!error || denied(error)) ok(`no lee ${table}`)
    else unproven(`la tabla ${table}`, error)
  }
  for (const [fn, args] of [
    ['find_guest', { p_email: 'x@x.com', p_code: 'XXXXXXXX' }],
    ['admin_list_guests', { p_actor: NIL }],
    ['admin_account_for_login', { p_username: 'chequeo' }],
    ['event_join', { p_key: 'x', p_name: 'x', p_email: 'x@x.com', p_code: 'X' }],
  ]) {
    const { error } = await anon.rpc(fn, args)
    if (!error) bad(`La clave publica PUEDE llamar a ${fn}`, 'Falta el REVOKE de esa funcion en su migracion')
    // Sin permiso, PostgREST responde 42501 o directamente que no la encuentra (no se la muestra a anon)
    else if (denied(error) || (schemaOk && notFound(error))) ok(`no puede llamar a ${fn}`)
    else unproven(`la funcion ${fn}`, error)
  }
}

// ---- Organizador ----
section('Cuenta de organizador')
const { count, error: countError } = await admin.from('admin_accounts').select('user_id', { count: 'exact', head: true })
if (countError) warn('No se pudo contar (¿faltan las migraciones?)')
else if (!count) warn('Todavia no hay cuenta de organizador', 'npm run create:admin -- tu-usuario (con LOCAL_DB comentado)')
else ok(`${count} cuenta(s) de organizador`)

console.log(
  failed
    ? `\n✘ ${failed} problema(s)${warned ? ` y ${warned} aviso(s)` : ''}. Resolvé los ✘ antes de probar la app.`
    : `\n✔ Listo para usar${warned ? ` (${warned} aviso(s), opcionales)` : ''}.`
)
process.exit(failed ? 1 : 0)
