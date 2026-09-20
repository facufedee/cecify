// Reglas de la lista de invitados: codigos de acceso y lectura de CSV. Sin acceso a la base.
import { randomInt } from 'node:crypto'
import { isSide, type Side } from '@/lib/profile-schema'
import { EMAIL_RE } from '@/lib/validators'

// Sin 0/O/1/I/L para que no se confundan al dictarlos o leerlos de una tarjeta
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 8

export const generateCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

export const normalizeCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase()

export const isValidCode = (code: string) => /^[A-Z0-9]{4,50}$/.test(code)

export const NAME_MAX = 100

const SIDE_ALIASES: Record<string, Side> = {
  novia: 'bride',
  bride: 'bride',
  novio: 'groom',
  groom: 'groom',
  ambos: 'both',
  ambas: 'both',
  both: 'both',
}

// '' = sin lado. undefined = valor no reconocido.
export const parseSide = (raw: string | undefined | null): Side | null | undefined => {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (isSide(v)) return v
  return SIDE_ALIASES[v]
}

export type CsvGuest = { name: string; email: string; code: string | null; side: Side | null | undefined }
export type CsvResult = {
  guests: CsvGuest[]
  errors: { line: number; message: string }[]
  hasSideColumn: boolean
}

export const CSV_MAX_ROWS = 1000

// CSV con cabecera name,email[,code][,side]. Acepta coma o punto y coma (Excel en espanol) y BOM.
// `side` es undefined si el CSV no trae esa columna (no se toca el lado de los que ya existen).
export const parseGuestsCsv = (text: string): CsvResult => {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l, i) => ({ text: l, line: i + 1 }))
    .filter((l) => l.text.trim())

  const errors: CsvResult['errors'] = []
  if (lines.length === 0) return { guests: [], errors: [{ line: 1, message: 'El archivo está vacío' }], hasSideColumn: false }

  const delimiter = lines[0].text.includes(';') && !lines[0].text.includes(',') ? ';' : ','
  const split = (l: string) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, '').trim())

  const header = split(lines[0].text).map((h) => h.toLowerCase())
  const col = (names: string[]) => header.findIndex((h) => names.includes(h))
  const iName = col(['name', 'nombre'])
  const iEmail = col(['email', 'mail', 'correo'])
  const iCode = col(['code', 'codigo', 'código'])
  const iSide = col(['side', 'lado'])
  if (iName < 0 || iEmail < 0) {
    return {
      guests: [],
      errors: [{ line: lines[0].line, message: 'La primera fila tiene que tener las columnas name y email' }],
      hasSideColumn: false,
    }
  }

  const rows = lines.slice(1)
  if (rows.length > CSV_MAX_ROWS) {
    return { guests: [], errors: [{ line: 1, message: `Como máximo ${CSV_MAX_ROWS} invitados por archivo` }], hasSideColumn: iSide >= 0 }
  }

  const seen = new Set<string>()
  const guests: CsvGuest[] = []
  for (const { text: raw, line } of rows) {
    const c = split(raw)
    const name = c[iName] ?? ''
    const email = (c[iEmail] ?? '').toLowerCase()
    const rawCode = iCode >= 0 ? (c[iCode] ?? '') : ''
    const code = rawCode ? normalizeCode(rawCode) : null

    if (!name || name.length > NAME_MAX) {
      errors.push({ line, message: 'Nombre vacío o demasiado largo' })
      continue
    }
    if (email.length > 255 || !EMAIL_RE.test(email)) {
      errors.push({ line, message: `Email inválido: ${email || '(vacío)'}` })
      continue
    }
    if (seen.has(email)) {
      errors.push({ line, message: `Email repetido en el archivo: ${email}` })
      continue
    }
    if (code && !isValidCode(code)) {
      errors.push({ line, message: `Código inválido para ${email}` })
      continue
    }
    let side: Side | null | undefined = undefined
    if (iSide >= 0) {
      side = parseSide(c[iSide])
      if (side === undefined) {
        errors.push({ line, message: `Lado no reconocido para ${email} (usá novia, novio o ambos)` })
        continue
      }
    }
    seen.add(email)
    guests.push({ name, email, code, side })
  }

  return { guests, errors, hasSideColumn: iSide >= 0 }
}
