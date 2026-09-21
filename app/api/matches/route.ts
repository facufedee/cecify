import { getAuth, unauthorized } from '@/lib/api-auth'
import { listConversations } from '@/lib/db'

export async function GET(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  try {
    const conversations = await listConversations(auth.userId)
    return Response.json({
      conversations,
      unreadTotal: conversations.reduce((sum, c) => sum + c.unread, 0),
    })
  } catch (error) {
    console.error('matches error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
