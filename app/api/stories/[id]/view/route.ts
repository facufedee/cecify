import { getAuth, unauthorized } from '@/lib/api-auth'
import { markStoryViewed } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { UUID_RE } from '@/lib/validators'

// Registra que el usuario vio la historia (idempotente; ignora las propias y las vencidas)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Historia inválida' }, { status: 400 })

  const limit = rateLimit(`story-view:${auth.userId}`, 200, 60_000)
  if (!limit.ok) return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })

  try {
    return Response.json({ marked: await markStoryViewed(auth.userId, id) })
  } catch (error) {
    console.error('stories/view error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
