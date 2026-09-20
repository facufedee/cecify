import { getAuth, unauthorized } from '@/lib/api-auth'
import { unblockUser } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`block:${auth.userId}`, 20, 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { userId } = await params
  if (!isUuid(userId)) return Response.json({ error: 'Invitado inválido' }, { status: 400 })

  try {
    if (!(await unblockUser(auth.userId, userId))) {
      return Response.json({ error: 'No lo tenías bloqueado' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('blocks/delete error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
