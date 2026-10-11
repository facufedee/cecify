// Codigo del casamiento y datos del alta. Sin dependencias del servidor: lo pueden usar el navegador y las rutas.
// Las mismas reglas que la base (create_wedding, normalize_wedding_code en supabase/migrations).
import { passwordProblem, USERNAME_RE } from '@/lib/password-rules'

// 6 caracteres sin los que se confunden (0/O, 1/I/L)
export const WEDDING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const WEDDING_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/
export const PARTNER_NAME_MAX = 60

// Lo que escribe la gente: sin espacios ni guiones y en mayusculas ("ab3 k7m" = "AB3K7M")
export const normalizeWeddingCode = (raw: string) => raw.replace(/[\s-]/g, '').toUpperCase()

// undefined = no vino codigo (la app de antes: la base usa el unico casamiento). null = mal formado.
export const parseWeddingCode = (raw: unknown): string | undefined | null => {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || raw.length > 40) return null
  const code = normalizeWeddingCode(raw)
  if (!code) return undefined
  return WEDDING_CODE_RE.test(code) ? code : null
}

// Largo como lo cuenta Postgres (caracteres, no unidades UTF-16: un emoji es uno)
const partnerName = (raw: unknown) => {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  const length = [...name].length
  return length >= 1 && length <= PARTNER_NAME_MAX ? name : null
}

// { partnerA, partnerB } recortados, o null si alguno falta, esta vacio o supera los 60 caracteres
export const parsePartnerNames = (body: unknown): { partnerA: string; partnerB: string } | null => {
  const b = (body ?? {}) as { partnerA?: unknown; partnerB?: unknown }
  const partnerA = partnerName(b.partnerA)
  const partnerB = partnerName(b.partnerB)
  return partnerA && partnerB ? { partnerA, partnerB } : null
}

export const PARTNER_NAMES_ERROR = `Escribí los nombres de los dos (hasta ${PARTNER_NAME_MAX} caracteres cada uno)`
export const USERNAME_ERROR = 'El usuario tiene que tener de 3 a 30 caracteres: letras, números, punto o guion'

export type NewWedding = { partnerA: string; partnerB: string; username: string; password: string }

// Alta de un casamiento: { partnerA, partnerB, username, password }. Usuario y contraseña con las mismas reglas
// que las cuentas de organizador (lib/password-rules.ts).
export const parseNewWedding = (body: unknown): { ok: true; value: NewWedding } | { ok: false; error: string } => {
  const names = parsePartnerNames(body)
  if (!names) return { ok: false, error: PARTNER_NAMES_ERROR }
  const b = body as { username?: unknown; password?: unknown }
  const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : ''
  if (!USERNAME_RE.test(username)) return { ok: false, error: USERNAME_ERROR }
  const password = typeof b.password === 'string' ? b.password : ''
  const problem = passwordProblem(password)
  if (problem) return { ok: false, error: problem }
  return { ok: true, value: { ...names, username, password } }
}
