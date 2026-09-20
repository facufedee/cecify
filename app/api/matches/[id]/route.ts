import { getAuth, unauthorized } from '@/lib/api-auth'
import { unmatch } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

// Deshace el match (por id de conversacion): desaparece el chat para ambos y no vuelven a aparecer en Descubrir
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`unmatch:${auth.userId}`, 20, 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Conversación inválida' }, { status: 400 })

  try {
    if (!(await unmatch(auth.userId, id))) {
      return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('matches/unmatch error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
