import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminReleaseGuest } from '@/lib/db/admin'
import { isUuid } from '@/lib/validators'

// Libera el nombre de un invitado para que pueda volver a elegirse de la lista (p. ej. cambio de celular).
// Cierra sus sesiones; la cuenta (perfil, matches, chats) se conserva.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Invitado inválido')

  try {
    switch (await adminReleaseGuest(actor.userId, id)) {
      case 'ok':
        return Response.json({ ok: true })
      case 'not_found':
        return badRequest('Invitado no encontrado', 404)
      case 'not_claimed':
        return badRequest('Su nombre ya está libre', 409)
      default:
        return badRequest('No tenés permiso para esto', 403)
    }
  } catch (error) {
    return serverError('admin/guests/release', error)
  }
}
