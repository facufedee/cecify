import { getAuth, unauthorized } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { markRead } from '@/lib/db'
import { UUID_RE } from '@/lib/validators'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`message-read:${auth.userId}`, 120, 60000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Conversación inválida' }, { status: 400 })

  try {
    return Response.json({ marked: await markRead(auth.userId, id) })
  } catch (error) {
    console.error('messages/read error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
