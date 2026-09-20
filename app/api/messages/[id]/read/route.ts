import { getAuth, unauthorized } from '@/lib/api-auth'
import { markRead } from '@/lib/db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Conversación inválida' }, { status: 400 })

  try {
    return Response.json({ marked: await markRead(auth.userId, id) })
  } catch (error) {
    console.error('messages/read error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
