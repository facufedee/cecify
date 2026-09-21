import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminListPhotos } from '@/lib/db/admin'

// Todas las fotos del muro (sin filtros de bloqueo). ?before=<fecha ISO> para paginar.
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const before = new URL(req.url).searchParams.get('before')
  if (before && Number.isNaN(Date.parse(before))) return badRequest('Fecha inválida')

  try {
    return Response.json({ photos: await adminListPhotos(actor.userId, { before: before ?? undefined, limit: 24 }) })
  } catch (error) {
    return serverError('admin/content/photos', error)
  }
}
