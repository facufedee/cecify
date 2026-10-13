import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminGetEventAccess, adminSetEventAccess } from '@/lib/db'

// El registro puede quedar habilitado como mucho una semana seguida (la fiesta dura una noche)
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Horario de registro del casamiento (event: null = todavia no se activo). event.key es el codigo del casamiento.
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor
  try {
    return Response.json({ event: await adminGetEventAccess(actor.userId) })
  } catch (error) {
    return serverError('admin/event', error)
  }
}

// { opensAt, closesAt }. Ya no hay clave de QR: el QR lleva el codigo del casamiento (newQr se ignora).
export async function PUT(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const body = (await req.json().catch(() => null)) as { opensAt?: unknown; closesAt?: unknown } | null
  const opens = typeof body?.opensAt === 'string' ? new Date(body.opensAt) : null
  const closes = typeof body?.closesAt === 'string' ? new Date(body.closesAt) : null
  if (!opens || !closes || Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) {
    return badRequest('Elegí desde y hasta cuándo funciona el QR')
  }
  if (closes <= opens) return badRequest('El cierre tiene que ser después de la apertura')
  if (closes.getTime() - opens.getTime() > MAX_WINDOW_MS) return badRequest('Como máximo puede quedar abierto una semana')

  try {
    if (!(await adminSetEventAccess(actor.userId, opens.toISOString(), closes.toISOString()))) {
      return badRequest('No tenés permiso para esto', 403)
    }
    return Response.json({ event: await adminGetEventAccess(actor.userId) })
  } catch (error) {
    return serverError('admin/event/put', error)
  }
}
