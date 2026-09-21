import { getAuth, unauthorized } from '@/lib/api-auth'
import { unreadTotal } from '@/lib/db'

export async function GET(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  try {
    return Response.json({ unread: await unreadTotal(auth.userId) })
  } catch (error) {
    console.error('messages/unread error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
