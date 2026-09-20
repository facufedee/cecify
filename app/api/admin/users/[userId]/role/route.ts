import { requireRole } from '@/lib/api-auth'
import { setUserRole } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

// Cambia el rol de un usuario. Solo superadmin (lo vuelve a comprobar set_user_role en SQL).
export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const actor = await requireRole(req, ['superadmin'])
  if (actor instanceof Response) return actor

  if (!rateLimit(`role:${actor.userId}`, 20, 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { userId } = await params
  if (!isUuid(userId)) return Response.json({ error: 'Usuario inválido' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }
  const role = (body as { role?: unknown } | null)?.role
  if (typeof role !== 'string') return Response.json({ error: 'Rol inválido' }, { status: 400 })

  try {
    const status = await setUserRole(actor.userId, userId, role)
    switch (status) {
      case 'ok':
        return Response.json({ ok: true, role })
      case 'invalid':
        return Response.json({ error: 'Rol inválido' }, { status: 400 })
      case 'not_found':
        return Response.json({ error: 'Usuario no encontrado' }, { status: 404 })
      case 'last_superadmin':
        return Response.json({ error: 'Tiene que quedar al menos un superadmin' }, { status: 409 })
      default:
        return Response.json({ error: 'No tenés permiso para esto' }, { status: 403 })
    }
  } catch (error) {
    console.error('admin/role error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
