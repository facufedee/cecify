import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminRevokeSessions } from '@/lib/db/admin'
import { isUuid } from '@/lib/validators'

// Cierra las sesiones abiertas de un invitado (en todos sus dispositivos). Puede volver a entrar con su codigo.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Invitado inválido')

  try {
    switch (await adminRevokeSessions(actor.userId, id)) {
      case 'ok':
        return Response.json({ ok: true })
      case 'not_found':
        return badRequest('Invitado no encontrado', 404)
      case 'no_account':
        return badRequest('Todavía no inició sesión: no hay sesiones para cerrar', 409)
      default:
        return badRequest('No tenés permiso para esto', 403)
    }
  } catch (error) {
    return serverError('admin/guests/revoke', error)
  }
}
