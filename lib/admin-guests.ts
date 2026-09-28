// Alta e importacion de invitados con generacion de codigos (un codigo repetido se reintenta).
import { isUniqueViolation } from '@/lib/admin-api'
import { adminUpdateGuest, adminUpsertGuest } from '@/lib/db/admin'
import { generateCode, type CsvGuest } from '@/lib/guests'
import type { Side } from '@/lib/profile-schema'

const MAX_ATTEMPTS = 5

// Reintenta con un codigo nuevo si el generado ya lo tiene otro invitado (es muy raro: 31^8 combinaciones)
const withNewCode = async <T>(fn: (code: string) => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(generateCode())
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= MAX_ATTEMPTS) throw error
    }
  }
}

// code null = cuenta con rol: solo un superadmin ve (y cambia) su codigo
export type SavedGuest = { id: string; email: string | null; code: string | null; created: boolean }

// Alta de un invitado. Si el email ya existe se actualiza el nombre (y el lado si viene) y se conserva su codigo.
export const addGuest = async (
  actorId: string,
  input: { name: string; email: string | null; side?: Side | null }
): Promise<SavedGuest | null> => {
  const saved = await withNewCode((code) => adminUpsertGuest(actorId, { ...input, code }))
  return saved ? { ...saved, email: input.email } : null
}

// Genera un codigo nuevo para un invitado que ya existe. null = no existe.
export const regenerateCode = async (actorId: string, guestId: string) => {
  const saved = await withNewCode((code) => adminUpdateGuest(actorId, guestId, { code }))
  return saved?.code ?? null
}

export type ImportSummary = {
  created: number
  updated: number
  rows: { name: string; email: string | null; code: string | null; created: boolean }[]
}

const BATCH = 10

// Importa en tandas para no tardar demasiado con listas grandes.
// - Sin codigo en el CSV: los nuevos reciben uno generado y los que ya existen conservan el suyo.
// - Con codigo en el CSV: se usa ese (tambien para los que ya existen).
// - Sin columna side no se toca el lado de los que ya existen.
export const importGuests = async (actorId: string, guests: CsvGuest[]): Promise<ImportSummary> => {
  const rows: ImportSummary['rows'] = []
  let created = 0
  let updated = 0

  for (let i = 0; i < guests.length; i += BATCH) {
    const results = await Promise.all(
      guests.slice(i, i + BATCH).map(async (g) => {
        const saved = g.code
          ? await adminUpsertGuest(actorId, { name: g.name, email: g.email, code: g.code, side: g.side, replaceCode: true })
          : await withNewCode((code) => adminUpsertGuest(actorId, { name: g.name, email: g.email, code, side: g.side }))
        return { g, saved }
      })
    )
    for (const { g, saved } of results) {
      if (!saved) throw new Error('Sin permiso') // el actor perdio el rol a mitad de la importacion
      rows.push({ name: g.name, email: g.email, code: saved.code, created: saved.created })
      if (saved.created) created++
      else updated++
    }
  }
  return { created, updated, rows }
}
