// Cuentas: login, rol y sesiones
import type { Role } from '@/lib/roles'
import { forgetSession } from '@/lib/session'
import { callFn } from '@/lib/db/core'

export type DbUser = { id: string; email: string; role: Role; sessionVersion: number }

// Sin resultado = el email o el codigo no corresponden a un invitado
export const findGuest = async (email: string, code: string) => {
  const [r] = await callFn<{ out_id: string }>('find_guest', { p_email: email, p_code: code })
  return r ? { id: r.out_id } : null
}

// Crea el user en el primer login; no toca role si ya existe
export const upsertUser = async (email: string): Promise<DbUser> => {
  const [r] = await callFn<{ out_id: string; out_email: string; out_role: Role; out_version: number }>('upsert_user', {
    p_email: email,
  })
  return { id: r.out_id, email: r.out_email, role: r.out_role, sessionVersion: r.out_version }
}

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
