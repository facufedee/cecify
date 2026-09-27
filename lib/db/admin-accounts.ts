// Cuentas de organizador con usuario y contraseña (el hash se calcula y verifica en lib/password.ts)
import { callFn, iso } from '@/lib/db/core'
import type { Role } from '@/lib/roles'

// null = no existe ese usuario
export const adminAccountForLogin = async (username: string) => {
  const [r] = await callFn<{ out_user: string; out_hash: string; out_role: Role; out_version: number }>(
    'admin_account_for_login',
    { p_username: username }
  )
  return r ? { userId: r.out_user, hash: r.out_hash, role: r.out_role, sessionVersion: r.out_version } : null
}

// null = la persona entra con codigo o QR (no tiene contraseña)
export const adminAccountOf = async (userId: string) => {
  const [r] = await callFn<{ out_username: string; out_hash: string; out_changed_at: string | Date }>('admin_account_of', {
    p_user: userId,
  })
  return r ? { username: r.out_username, hash: r.out_hash, changedAt: iso(r.out_changed_at) } : null
}

// Guarda el hash nuevo y cierra las demas sesiones. Devuelve la version de sesion nueva (null = sin cuenta).
export const setAdminPassword = async (userId: string, hash: string) => {
  const [r] = await callFn<{ out_version: number }>('set_admin_password', { p_user: userId, p_hash: hash })
  return r?.out_version ?? null
}
