import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminListReports, type ReportStatus } from '@/lib/db-admin'

const STATUSES: ReportStatus[] = ['open', 'reviewed', 'dismissed']

// ?status=open|reviewed|dismissed (sin status = todos) &before=<fecha ISO> para paginar.
// La copia de una conversacion reportada solo la ve un superadmin: es lo mas privado que se guarda.
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const params = new URL(req.url).searchParams
  const status = params.get('status')
  if (status && !STATUSES.includes(status as ReportStatus)) return badRequest('Estado inválido')
  const before = params.get('before')
  if (before && Number.isNaN(Date.parse(before))) return badRequest('Fecha inválida')

  try {
    const reports = await adminListReports(actor.userId, {
      status: (status as ReportStatus | null) ?? undefined,
      before: before ?? undefined,
      limit: 30,
    })
    return Response.json({
      reports: reports.map((r) =>
        r.type === 'chat' && actor.role !== 'superadmin' ? { ...r, context: { restricted: true } } : r
      ),
    })
  } catch (error) {
    return serverError('admin/reports', error)
  }
}
