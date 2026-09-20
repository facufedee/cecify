import { verifyToken } from '@/lib/auth'

// Uso en route handlers: const auth = getAuth(req); if (!auth) return unauthorized()
export const getAuth = (req: Request) => {
  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  return verifyToken(token)
}

export const unauthorized = () =>
  Response.json({ error: 'No autorizado' }, { status: 401 })
