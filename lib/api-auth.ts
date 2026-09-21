import { verifyToken } from '@/lib/auth'
import { getSessionInfo, getUserRole } from '@/lib/db'
import type { Role } from '@/lib/roles'
import { loadSession } from '@/lib/session'

// Uso en route handlers: const auth = await getAuth(req); if (!auth) return unauthorized()
// Ademas de la firma del token comprueba en la base que el usuario exista y que la sesion no se haya
// revocado. El rol que devuelve es el actual de la base (no el que quedo en el token).
export const getAuth = async (req: Request) => {
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  const session = await loadSession(payload.userId, getSessionInfo)
  if (!session || session.version !== (payload.v ?? 0)) return null

  return {
    userId: payload.userId,
    role: session.role,
    version: session.version,
    // tokens anteriores a las sesiones revocables no traen `sa`: se toma desde que se emitieron
    sessionStart: payload.sa ?? payload.iat ?? 0,
  }
}

export const unauthorized = () =>
  Response.json({ error: 'No autorizado' }, { status: 401 })

export const forbidden = () =>
  Response.json({ error: 'No tenés permiso para esto' }, { status: 403 })

// Para rutas de administracion. Lee el rol directo de la base en cada pedido (sin cache), asi que
// quitarle el permiso a alguien rige al instante. Uso:
//   const admin = await requireRole(req, ['admin', 'superadmin'])
//   if (admin instanceof Response) return admin
export const requireRole = async (
  req: Request,
  allowed: readonly Role[]
): Promise<{ userId: string; role: Role } | Response> => {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const role = await getUserRole(auth.userId)
  if (!role) return unauthorized() // el usuario ya no existe
  if (!allowed.includes(role)) return forbidden()
  return { userId: auth.userId, role }
}
