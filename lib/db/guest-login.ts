// Login de invitados: buscar el nombre en la lista y un PIN de 4 numeros (el hash lo calcula lib/password.ts)
import { callFn } from '@/lib/db/core'
import type { Role } from '@/lib/roles'

// returning = le reiniciaron el PIN: inventa otro aunque el registro este cerrado
export type FoundGuest = { id: string; name: string; side: string | null; claimed: boolean; returning: boolean }

// 2+ letras, hasta 8. registrationOpen: si hoy se puede registrar alguien nuevo.
export const guestSearch = async (query: string): Promise<{ guests: FoundGuest[]; registrationOpen: boolean | null }> => {
  const rows = await callFn<{ out_id: string; out_name: string; out_side: string | null; out_claimed: boolean; out_returning: boolean; out_registration_open: boolean }>(
    'guest_search',
    { p_query: query }
  )
  return {
    guests: rows.map((r) => ({ id: r.out_id, name: r.out_name, side: r.out_side, claimed: r.out_claimed, returning: r.out_returning })),
    registrationOpen: rows[0]?.out_registration_open ?? null, // null = sin resultados (no se sabe)
  }
}

export const registrationOpen = async () => {
  const [r] = await callFn<{ out_open: boolean }>('registration_status', {})
  return r?.out_open === true
}

type Session = { userId: string; role: Role; sessionVersion: number }
type SessionRow = { out_status: string; out_id: string | null; out_role: Role | null; out_version: number | null }
const session = (r: SessionRow): Session => ({ userId: r.out_id!, role: r.out_role!, sessionVersion: r.out_version! })

// Primera vez: se elige y guarda el hash de su PIN
export const guestRegister = async (
  guestId: string,
  pinHash: string
): Promise<({ status: 'ok' } & Session) | { status: 'closed' | 'taken' | 'not_found' }> => {
  const [r] = await callFn<SessionRow>('guest_register', { p_guest: guestId, p_pin_hash: pinHash })
  if (r?.out_status === 'ok') return { status: 'ok', ...session(r) }
  const s = r?.out_status
  return { status: s === 'closed' || s === 'taken' ? s : 'not_found' }
}

// null = no existe o todavia no se registro
export const guestPinForLogin = async (guestId: string) => {
  const [r] = await callFn<{ out_hash: string; out_locked_until: string | Date | null }>('guest_pin_for_login', { p_guest: guestId })
  return r ? { hash: r.out_hash, lockedUntil: r.out_locked_until ? new Date(r.out_locked_until) : null } : null
}

export type PinAttempt =
  | ({ status: 'ok' } & Session)
  | { status: 'wrong'; left: number }
  | { status: 'locked'; until: Date }
  | { status: 'not_found' }

// Registra el resultado de un intento (el PIN ya se verifico): cuenta los fallidos y traba al quinto
export const guestPinAttempt = async (guestId: string, ok: boolean): Promise<PinAttempt> => {
  const [r] = await callFn<SessionRow & { out_left: number | null; out_locked_until: string | Date | null }>('guest_pin_attempt', {
    p_guest: guestId,
    p_ok: ok,
  })
  switch (r?.out_status) {
    case 'ok':
      return { status: 'ok', ...session(r) }
    case 'wrong':
      return { status: 'wrong', left: r.out_left ?? 0 }
    case 'locked':
      return { status: 'locked', until: new Date(r.out_locked_until!) }
    default:
      return { status: 'not_found' }
  }
}
