// QR de la fiesta: entrada sin invitacion previa y su configuracion en el panel
import { callFn, iso } from '@/lib/db/core'
import type { Role } from '@/lib/roles'

export type EventJoinResult =
  | { status: 'ok'; userId: string; role: Role; sessionVersion: number; existing: boolean }
  | { status: 'invalid' | 'closed' }

// `code` es el codigo de la fila de guests (si se repite, lanza unique_violation: reintentar con otro)
export const eventJoin = async (key: string, name: string, email: string, code: string): Promise<EventJoinResult> => {
  const [r] = await callFn<{
    out_status: 'ok' | 'invalid' | 'closed'
    out_id: string | null
    out_role: Role | null
    out_version: number | null
    out_existing: boolean | null
  }>('event_join', { p_key: key, p_name: name, p_email: email, p_code: code })
  if (r?.out_status !== 'ok') return { status: r?.out_status === 'closed' ? 'closed' : 'invalid' }
  return { status: 'ok', userId: r.out_id!, role: r.out_role!, sessionVersion: r.out_version!, existing: r.out_existing === true }
}

export type EventAccess = { key: string; opensAt: string; closesAt: string; joined: number }

// null = todavia no se activo (o sin permiso)
export const adminGetEventAccess = async (actorId: string): Promise<EventAccess | null> => {
  const [r] = await callFn<{ out_key: string; out_opens: string | Date; out_closes: string | Date; out_joined: number }>(
    'admin_get_event_access',
    { p_actor: actorId }
  )
  return r ? { key: r.out_key, opensAt: iso(r.out_opens), closesAt: iso(r.out_closes), joined: r.out_joined } : null
}

// key null = conservar la actual. false = sin permiso.
export const adminSetEventAccess = async (actorId: string, key: string | null, opensAt: string, closesAt: string) => {
  const [r] = await callFn<{ out_ok: boolean }>('admin_set_event_access', {
    p_actor: actorId,
    p_key: key,
    p_opens: opensAt,
    p_closes: closesAt,
  })
  return r?.out_ok === true
}

// ---- Elegirse de la lista de invitados ----

export type ListGuest = { id: string; name: string; side: string | null; taken: boolean }
export type EventSearchResult = { status: 'ok'; guests: ListGuest[] } | { status: 'invalid' | 'closed' }

// Busca en la lista (2+ letras, hasta 8). Con el QR invalido o cerrado no devuelve nombres.
export const eventSearchGuests = async (key: string, query: string): Promise<EventSearchResult> => {
  const rows = await callFn<{ out_status: string; out_id: string | null; out_name: string | null; out_side: string | null; out_taken: boolean | null }>(
    'event_search_guests',
    { p_key: key, p_query: query }
  )
  const problem = rows.find((r) => r.out_status !== 'ok')
  if (problem) return { status: problem.out_status === 'closed' ? 'closed' : 'invalid' }
  return { status: 'ok', guests: rows.map((r) => ({ id: r.out_id!, name: r.out_name!, side: r.out_side, taken: r.out_taken === true })) }
}

export type EventClaimResult =
  | { status: 'ok'; userId: string; role: Role; sessionVersion: number }
  | { status: 'invalid' | 'closed' | 'not_found' | 'taken' }

export const eventClaimGuest = async (key: string, guestId: string): Promise<EventClaimResult> => {
  const [r] = await callFn<{ out_status: string; out_id: string | null; out_role: Role | null; out_version: number | null }>(
    'event_claim_guest',
    { p_key: key, p_guest: guestId }
  )
  if (r?.out_status === 'ok') return { status: 'ok', userId: r.out_id!, role: r.out_role!, sessionVersion: r.out_version! }
  const status = r?.out_status
  return { status: status === 'closed' || status === 'not_found' || status === 'taken' ? status : 'invalid' }
}
