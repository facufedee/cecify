import { requireRole } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'

// Todas las rutas de /api/admin arrancan igual:
//   const actor = await adminOnly(req)
//   if (actor instanceof Response) return actor
// Lee el rol de la base (no del token) y aplica un limite holgado por administrador.
export const adminOnly = async (req: Request) => {
  const actor = await requireRole(req, ['admin', 'superadmin'])
  if (actor instanceof Response) return actor
  if (!rateLimit(`admin:${actor.userId}`, 240, 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }
  return actor
}

export const badRequest = (error: string, status = 400) => Response.json({ error }, { status })

export const serverError = (label: string, error: unknown) => {
  console.error(`${label} error:`, error)
  return Response.json({ error: 'Error del servidor' }, { status: 500 })
}

// Postgres: unique_violation (p. ej. un codigo de acceso repetido)
// Postgres: insufficient_privilege (p. ej. un admin quiere cambiar el codigo de otro admin)
export const isInsufficientPrivilege = (error: unknown) => (error as { code?: string } | null)?.code === '42501'

export const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === '23505'
