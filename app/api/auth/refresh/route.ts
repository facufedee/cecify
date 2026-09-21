import { getAuth, unauthorized } from '@/lib/api-auth'
import { generateToken, MAX_SESSION_SECONDS } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'

// Renueva el token mientras la sesion siga vigente: mantiene el inicio de la sesion original (no se
// puede renovar para siempre: pasadas MAX_SESSION_SECONDS hay que volver a entrar) y trae el rol actual.
export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`refresh:${auth.userId}`, 30, 60 * 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const now = Math.floor(Date.now() / 1000)
  if (now - auth.sessionStart > MAX_SESSION_SECONDS) {
    return Response.json({ error: 'La sesión venció, entrá de nuevo', code: 'SESSION_EXPIRED' }, { status: 401 })
  }

  const token = generateToken(auth.userId, auth.role, { version: auth.version, sessionStart: auth.sessionStart })
  return Response.json({ token })
}
