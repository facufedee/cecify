// Uso: npm run create:admin -- <usuario> [codigo-del-casamiento]
// Crea una cuenta de organizador (superadmin) con usuario y contraseña, o le cambia la contraseña si ya existe.
// Con el codigo, la cuenta nueva va a ese casamiento; sin el, solo funciona mientras haya un unico casamiento.
// (A una cuenta que ya existe solo se le cambia la contraseña: sigue en su casamiento.)
// La contraseña se pide por la terminal sin mostrarla (o se toma de ADMIN_NEW_PASSWORD). Nunca se guarda en texto:
// solo su hash. Entra en /login/admin.
//
// Con LOCAL_DB=1 escribe en la base local (.local-db): frená `npm run dev` antes (la base es de un solo proceso)
// y corré la app al menos una vez para que tenga las migraciones. Sin LOCAL_DB, en Supabase.
import { createInterface } from 'node:readline'
import { hashPassword } from '../lib/password.ts'
import { passwordProblem, USERNAME_RE } from '../lib/password-rules.ts'

// Mismas reglas que lib/wedding-code.ts (sin imports con alias: este script corre con node directo)
const WEDDING_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/

const username = (process.argv[2] ?? '').trim().toLowerCase()
if (!USERNAME_RE.test(username)) {
  console.error('Uso: npm run create:admin -- <usuario> [codigo]   (usuario: 3 a 30 caracteres: letras, numeros, punto, guion)')
  process.exit(1)
}
const weddingCode = process.argv[3] ? process.argv[3].replace(/[\s-]/g, '').toUpperCase() : null
if (weddingCode !== null && !WEDDING_CODE_RE.test(weddingCode)) {
  console.error('El codigo del casamiento tiene 6 caracteres (letras y numeros, sin 0, 1, I, L ni O)')
  process.exit(1)
}
const noWedding = () => {
  console.error(`No existe un casamiento con el codigo ${weddingCode}`)
  process.exit(1)
}

// Pregunta sin mostrar lo que se escribe
const ask = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '')
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })

let password = process.env.ADMIN_NEW_PASSWORD
if (!password) {
  password = await ask('Contraseña: ')
  if ((await ask('Repetila: ')) !== password) {
    console.error('Las contraseñas no coinciden')
    process.exit(1)
  }
}
const problem = passwordProblem(password)
if (problem) {
  console.error(problem)
  process.exit(1)
}

const hash = await hashPassword(password)
let created

if (process.env.LOCAL_DB === '1') {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite('.local-db')
  try {
    let wedding = null
    if (weddingCode) {
      const { rows: found } = await db.query('select * from wedding_by_code(p_code => $1)', [weddingCode])
      if (!found[0]) noWedding()
      wedding = found[0].out_id
    }
    const { rows } = await db.query('select * from create_admin_account(p_username => $1, p_hash => $2, p_wedding => $3)', [
      username,
      hash,
      wedding,
    ])
    created = rows[0].out_created
  } catch (error) {
    console.error('No se pudo crear la cuenta en la base local:', error.message)
    console.error('¿Está corriendo `npm run dev`? Frenalo antes. ¿Nunca corriste la app? Corrila una vez para aplicar las migraciones.')
    process.exit(1)
  } finally {
    await db.close()
  }
} else {
  // Sin el /rest/v1 que a veces se pega de mas (con eso todas las consultas fallan)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(new RegExp('/rest/v1/?$'), '').replace(new RegExp('/+$'), '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (o usá LOCAL_DB=1)')
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  let wedding = null
  if (weddingCode) {
    const { data: found, error: findError } = await supabase.rpc('wedding_by_code', { p_code: weddingCode })
    if (findError) {
      console.error('No se pudo buscar el casamiento:', findError.message)
      process.exit(1)
    }
    if (!found?.[0]) noWedding()
    wedding = found[0].out_id
  }
  const { data, error } = await supabase.rpc('create_admin_account', {
    p_username: username,
    p_hash: hash,
    p_wedding: wedding,
  })
  if (error) {
    console.error('No se pudo crear la cuenta:', error.message)
    process.exit(1)
  }
  created = data[0].out_created
}

console.log(
  created
    ? `Listo: "${username}" es superadmin. Entrá en /login/admin.`
    : `Listo: "${username}" tiene contraseña nueva (y se cerraron sus sesiones abiertas).`
)
