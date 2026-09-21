import { getAuth, unauthorized } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { deleteStory } from '@/lib/db'
import { UUID_RE } from '@/lib/validators'

// Solo el autor puede borrar su historia
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`story-delete:${auth.userId}`, 30, 60000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Historia inválida' }, { status: 400 })

  try {
    if (!(await deleteStory(auth.userId, id))) {
      return Response.json({ error: 'Historia no encontrada' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('stories/delete error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
