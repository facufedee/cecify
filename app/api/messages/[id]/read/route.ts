import { after } from 'next/server'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { listConversations, markRead } from '@/lib/db'
import { emitTo } from '@/lib/realtime'
import { UUID_RE } from '@/lib/validators'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`message-read:${auth.userId}`, 120, 60000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Conversación inválida' }, { status: 400 })

  try {
    const { marked, readUpTo } = await markRead(auth.userId, id)

    // Si habia algo nuevo, la otra persona ve el "Visto" al instante (si no le llega, lo ve al actualizar)
    if (marked > 0 && readUpTo) {
      const other = (await listConversations(auth.userId)).find((c) => c.id === id)?.other.userId
      if (other) after(() => emitTo(other, 'messages:read', { conversationId: id, readUpTo }))
    }

    return Response.json({ marked })
  } catch (error) {
    console.error('messages/read error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
