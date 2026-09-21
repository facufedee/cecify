import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { regenerateCode } from '@/lib/admin-guests'
import { adminDeleteGuest, adminUpdateGuest } from '@/lib/db/admin'
import { NAME_MAX, parseSide } from '@/lib/guests'
import { isUuid } from '@/lib/validators'

// { name?, side?: 'bride'|'groom'|'both'|null, newCode?: true }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Invitado inválido')

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Body inválido')

  let name: string | undefined
  if (body.name !== undefined) {
    name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > NAME_MAX) return badRequest('Nombre inválido')
  }
  let side: ReturnType<typeof parseSide>
  if ('side' in body) {
    side = body.side === null ? null : parseSide(typeof body.side === 'string' ? body.side : 'x')
    if (side === undefined) return badRequest('Lado inválido')
  }

  try {
    let code: string | undefined
    if (name !== undefined || side !== undefined) {
      const saved = await adminUpdateGuest(actor.userId, id, { name, side })
      if (!saved) return badRequest('Invitado no encontrado', 404)
      code = saved.code
    }
    if (body.newCode === true) {
      const fresh = await regenerateCode(actor.userId, id)
      if (!fresh) return badRequest('Invitado no encontrado', 404)
      code = fresh
    }
    if (code === undefined) return badRequest('No hay nada para cambiar')
    return Response.json({ ok: true, code })
  } catch (error) {
    return serverError('admin/guests/patch', error)
  }
}

// Quita al invitado de la lista y borra su cuenta y todo lo suyo. No se puede con quien tiene rol de admin.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Invitado inválido')

  try {
    switch (await adminDeleteGuest(actor.userId, id)) {
      case 'ok':
        return Response.json({ ok: true })
      case 'not_found':
        return badRequest('Invitado no encontrado', 404)
      case 'has_role':
        return badRequest('Es administrador: un superadmin tiene que quitarle el rol primero', 409)
      default:
        return badRequest('No tenés permiso para esto', 403)
    }
  } catch (error) {
    return serverError('admin/guests/delete', error)
  }
}
