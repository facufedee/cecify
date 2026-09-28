import { getAuth, unauthorized } from '@/lib/api-auth'
import { resetSkips } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

// Volver a ver en Descubrir los perfiles que se pasaron. Los "me gusta" y los matches no se tocan.
export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`reset-skips:${auth.userId}`, 10, 60 * 60_000).ok) {
    return Response.json({ error: 'Esperá un rato para volver a hacerlo' }, { status: 429 })
  }

  try {
    return Response.json({ restored: await resetSkips(auth.userId) })
  } catch (error) {
    console.error('swipes/reset error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
