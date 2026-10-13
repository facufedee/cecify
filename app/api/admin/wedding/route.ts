import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminUpdateWedding } from '@/lib/db'
import { PARTNER_NAMES_ERROR, parsePartnerNames } from '@/lib/wedding-code'

// Cambia los nombres de la pareja: { partnerA, partnerB }. Solo un superadmin (lo controla la base).
export async function PATCH(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const names = parsePartnerNames(await req.json().catch(() => null))
  if (!names) return badRequest(PARTNER_NAMES_ERROR)

  try {
    switch (await adminUpdateWedding(actor.userId, names.partnerA, names.partnerB)) {
      case 'ok':
        return Response.json({ ok: true, ...names })
      case 'invalid':
        return badRequest(PARTNER_NAMES_ERROR)
      default:
        return badRequest('Solo los dueños del casamiento pueden cambiar los nombres', 403)
    }
  } catch (error) {
    return serverError('admin/wedding', error)
  }
}
