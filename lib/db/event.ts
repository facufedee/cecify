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
