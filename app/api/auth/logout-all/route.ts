import { getAuth, unauthorized } from '@/lib/api-auth'
import { revokeSessions } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

// Cierra la sesion en TODOS los dispositivos (tambien en este): los tokens anteriores dejan de servir.
export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`logout-all:${auth.userId}`, 10, 60 * 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  try {
    await revokeSessions(auth.userId)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('auth/logout-all error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
