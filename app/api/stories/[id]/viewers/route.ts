import { getAuth, unauthorized } from '@/lib/api-auth'
import { listStoryViewers } from '@/lib/db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Quien vio la historia. Solo responde con datos si la historia es del usuario que pregunta.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Historia inválida' }, { status: 400 })

  try {
    return Response.json({ viewers: await listStoryViewers(auth.userId, id) })
  } catch (error) {
    console.error('stories/viewers error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
