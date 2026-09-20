import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminDeletePhoto, adminListComments } from '@/lib/db-admin'
import { isUuid } from '@/lib/validators'

// Comentarios de una foto
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Foto inválida')

  try {
    return Response.json({ comments: await adminListComments(actor.userId, id) })
  } catch (error) {
    return serverError('admin/content/photos/comments', error)
  }
}

// Borra la foto con sus comentarios y me gusta. (El archivo queda en el storage: ver PLAN 3.3.)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Foto inválida')

  try {
    if (!(await adminDeletePhoto(actor.userId, id))) return badRequest('Foto no encontrada', 404)
    return Response.json({ ok: true })
  } catch (error) {
    return serverError('admin/content/photos/delete', error)
  }
}
