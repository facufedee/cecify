// Horario del registro de invitados nuevos (panel). La clave del QR ya no se usa: el QR solo abre la app.
import { callFn, iso } from '@/lib/db/core'

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

