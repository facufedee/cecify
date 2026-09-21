import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminDeleteComment } from '@/lib/db/admin'
import { isUuid } from '@/lib/validators'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Comentario inválido')

  try {
    if (!(await adminDeleteComment(actor.userId, id))) return badRequest('Comentario no encontrado', 404)
    return Response.json({ ok: true })
  } catch (error) {
    return serverError('admin/content/comments/delete', error)
  }
}
