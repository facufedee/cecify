import { verifyToken } from '@/lib/auth'
import { getUserRole } from '@/lib/db'
import type { Role } from '@/lib/roles'

// Uso en route handlers: const auth = getAuth(req); if (!auth) return unauthorized()
export const getAuth = (req: Request) => {
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  return verifyToken(token)
}

export const unauthorized = () =>
  Response.json({ error: 'No autorizado' }, { status: 401 })

export const forbidden = () =>
  Response.json({ error: 'No tenés permiso para esto' }, { status: 403 })

// Para rutas de administracion. Lee el rol de la base (no del token, que puede tener hasta 12 h
// y no se entera si te quitaron el permiso). Uso:
//   const admin = await requireRole(req, ['admin', 'superadmin'])
//   if (admin instanceof Response) return admin
export const requireRole = async (
  req: Request,
  allowed: readonly Role[]
): Promise<{ userId: string; role: Role } | Response> => {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const role = await getUserRole(auth.userId)
  if (!role) return unauthorized() // el usuario ya no existe
  if (!allowed.includes(role)) return forbidden()
  return { userId: auth.userId, role }
}
