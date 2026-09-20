// Roles de la app (permisos). Sin imports de servidor: lo usan cliente y servidor.
//   guest      invitado comun
//   admin      modera, carga invitados y ve los reportes
//   superadmin lo de admin + nombrar y quitar admins (los novios)
export const ROLES = ['guest', 'admin', 'superadmin'] as const
export type Role = (typeof ROLES)[number]

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)

export const isAdminRole = (role: Role | null | undefined) => role === 'admin' || role === 'superadmin'

export const ROLE_LABELS: Record<Role, string> = {
  guest: 'Invitado',
  admin: 'Administrador',
  superadmin: 'Superadministrador',
}
