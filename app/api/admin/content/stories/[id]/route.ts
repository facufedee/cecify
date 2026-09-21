import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminDeleteStory } from '@/lib/db/admin'
import { isUuid } from '@/lib/validators'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Historia inválida')

  try {
    if (!(await adminDeleteStory(actor.userId, id))) return badRequest('Historia no encontrada', 404)
    return Response.json({ ok: true })
  } catch (error) {
    return serverError('admin/content/stories/delete', error)
  }
}
