import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminSetReportStatus } from '@/lib/db/admin'
import { isUuid } from '@/lib/validators'

// Marca un reporte como revisado, descartado o vuelve a abrirlo
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const { id } = await params
  if (!isUuid(id)) return badRequest('Reporte inválido')

  const status = ((await req.json().catch(() => null)) as { status?: unknown } | null)?.status
  if (status !== 'open' && status !== 'reviewed' && status !== 'dismissed') return badRequest('Estado inválido')

  try {
    if (!(await adminSetReportStatus(actor.userId, id, status))) return badRequest('Reporte no encontrado', 404)
    return Response.json({ ok: true, status })
  } catch (error) {
    return serverError('admin/reports/patch', error)
  }
}
