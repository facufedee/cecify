// Casamientos: alta (con la cuenta del dueño), datos publicos por codigo, el de quien tiene sesion y sus nombres
import { callFn, iso } from '@/lib/db/core'

export type CreateWeddingResult =
  | { status: 'ok'; weddingId: string; code: string; userId: string }
  | { status: 'invalid_names' | 'invalid_username' | 'username_taken' }

// Crea el casamiento con su codigo y la cuenta superadmin del dueño. Si algo falla no se crea nada.
export const createWedding = async (
  partnerA: string,
  partnerB: string,
  username: string,
  passwordHash: string
): Promise<CreateWeddingResult> => {
  const [r] = await callFn<{ out_status: string; out_wedding: string | null; out_code: string | null; out_user: string | null }>(
    'create_wedding',
    { p_partner_a: partnerA, p_partner_b: partnerB, p_username: username, p_password_hash: passwordHash }
  )
  if (r?.out_status === 'ok') return { status: 'ok', weddingId: r.out_wedding!, code: r.out_code!, userId: r.out_user! }
  const s = r?.out_status
  if (s === 'invalid_names' || s === 'invalid_username' || s === 'username_taken') return { status: s }
  throw new Error(`create_wedding: estado inesperado ${String(s)}`)
}

// Datos publicos para la entrada de invitados. null = el codigo no existe. El id es solo para el servidor.
export const weddingByCode = async (code: string) => {
  const [r] = await callFn<{ out_id: string; out_partner_a: string; out_partner_b: string; out_registration_open: boolean }>(
    'wedding_by_code',
    { p_code: code }
  )
  return r ? { id: r.out_id, partnerA: r.out_partner_a, partnerB: r.out_partner_b, registrationOpen: r.out_registration_open } : null
}

// El casamiento de una persona con sesion. null = la cuenta no existe.
export const weddingOfUser = async (userId: string) => {
  const [r] = await callFn<{
    out_id: string
    out_code: string
    out_partner_a: string
    out_partner_b: string
    out_opens: string | Date | null
    out_closes: string | Date | null
  }>('wedding_of_user', { p_user_id: userId })
  return r
    ? {
        id: r.out_id,
        code: r.out_code,
        partnerA: r.out_partner_a,
        partnerB: r.out_partner_b,
        opensAt: r.out_opens ? iso(r.out_opens) : null,
        closesAt: r.out_closes ? iso(r.out_closes) : null,
      }
    : null
}

// Cambia los nombres de la pareja. Solo un superadmin de ese casamiento.
export const adminUpdateWedding = async (adminId: string, partnerA: string, partnerB: string) => {
  const [r] = await callFn<{ out_status: string }>('admin_update_wedding', {
    p_admin: adminId,
    p_partner_a: partnerA,
    p_partner_b: partnerB,
  })
  const s = r?.out_status
  if (s === 'ok' || s === 'invalid' || s === 'forbidden') return s
  throw new Error(`admin_update_wedding: estado inesperado ${s}`)
}
