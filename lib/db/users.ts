// Cuentas: rol y sesiones (el login de invitados esta en guest-login.ts)
import type { Role } from '@/lib/roles'
import { forgetSession } from '@/lib/session'
import { callFn } from '@/lib/db/core'

// Version de sesion y rol actuales (null = el usuario ya no existe). Lo usa getAuth en cada pedido.
export const getSessionInfo = async (userId: string): Promise<{ version: number; role: Role } | null> => {
  const [r] = await callFn<{ out_version: number; out_role: Role }>('get_session_info', { p_user: userId })
  return r ? { version: r.out_version, role: r.out_role } : null
}

// Cierra todas las sesiones de la persona (en todos los dispositivos). Devuelve la version nueva.
export const revokeSessions = async (userId: string): Promise<number | null> => {
  const [r] = await callFn<{ out_version: number }>('revoke_sessions', { p_user: userId })
  forgetSession(userId)
  return r?.out_version ?? null
}

// Rol actual (siempre desde la base: el del token puede estar desactualizado hasta 12 h)
export const getUserRole = async (userId: string): Promise<Role | null> => (await getSessionInfo(userId))?.role ?? null

export type SetRoleStatus = 'ok' | 'invalid' | 'forbidden' | 'not_found' | 'last_superadmin'

// Solo un superadmin puede cambiar roles (lo decide set_user_role en SQL)
export const setUserRole = async (actorId: string, targetId: string, role: string): Promise<SetRoleStatus> => {
  const rows = await callFn<{ status: SetRoleStatus }>('set_user_role', {
    p_actor: actorId,
    p_target: targetId,
    p_role: role,
  })
  return rows[0].status
}
