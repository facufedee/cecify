// Uso: npm run import:guests -- ruta/invitados.csv
// CSV con cabecera: name,email[,code]   (sin comas dentro de los campos)
// - Si falta el codigo, se genera uno (solo para emails nuevos: nunca pisa codigos existentes).
// - Escribe <archivo>.con-codigos.csv con los codigos para enviar las invitaciones.
import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sin 0/O/1/I/L
const genCode = () =>
  Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
const pretty = (c) => `${c.slice(0, 4)}-${c.slice(4)}`

const file = process.argv[2]
if (!file) {
  console.error('Falta el archivo CSV. Uso: npm run import:guests -- invitados.csv')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim())
const header = lines.shift().split(',').map((h) => h.trim().toLowerCase())
const idx = (n) => header.indexOf(n)
if (idx('name') < 0 || idx('email') < 0) {
  console.error('La cabecera debe incluir name y email')
  process.exit(1)
}

const rows = lines.map((l) => {
  const c = l.split(',').map((x) => x.trim())
  return {
    name: c[idx('name')],
    email: c[idx('email')]?.toLowerCase(),
    code: idx('code') >= 0 && c[idx('code')] ? c[idx('code')].replace(/[\s-]/g, '').toUpperCase() : null,
  }
})

const { data: existing, error: exErr } = await supabase.from('guests').select('email, access_code')
if (exErr) {
  console.error('No se pudo leer guests (¿aplicaste la migración?):', exErr.message)
  process.exit(1)
}
const existingByEmail = new Map(existing.map((g) => [g.email, g.access_code]))

const toUpsert = []
const output = ['name,email,code']
for (const r of rows) {
  if (!r.name || !r.email || !r.email.includes('@')) {
    console.warn('Fila inválida, se omite:', JSON.stringify(r))
    continue
  }
  const current = existingByEmail.get(r.email)
  const code = r.code ?? current ?? genCode()
  if (current && !r.code) {
    output.push(`${r.name},${r.email},${pretty(current)}`)
    continue // ya existe y no se pidió cambiar el codigo
  }
  toUpsert.push({ name: r.name, email: r.email, access_code: code })
  output.push(`${r.name},${r.email},${pretty(code)}`)
}

if (toUpsert.length) {
  const { error } = await supabase.from('guests').upsert(toUpsert, { onConflict: 'email' })
  if (error) {
    console.error('Error al importar:', error.message)
    process.exit(1)
  }
}

const out = file.replace(/\.csv$/i, '') + '.con-codigos.csv'
writeFileSync(out, output.join('\n') + '\n')
console.log(`Importados/actualizados: ${toUpsert.length} · sin cambios: ${rows.length - toUpsert.length}`)
console.log(`Códigos guardados en ${out}`)
