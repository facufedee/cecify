import { adminOnly, serverError } from '@/lib/admin-api'
import { adminRecentActions, adminStats } from '@/lib/db-admin'

// Metricas del evento + ultimas acciones de administracion
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  try {
    const [stats, actions] = await Promise.all([adminStats(actor.userId), adminRecentActions(actor.userId, 15)])
    return Response.json({ stats, actions, role: actor.role })
  } catch (error) {
    return serverError('admin/overview', error)
  }
}
