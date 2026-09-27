import { randomBytes } from 'node:crypto'
import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { adminGetEventAccess, adminSetEventAccess } from '@/lib/db'

// Un QR puede quedar habilitado como mucho una semana seguida (la fiesta dura una noche)
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const newKey = () => randomBytes(18).toString('base64url') // 24 caracteres

// Configuracion del QR de la fiesta (event: null = todavia no se activo)
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor
  try {
    return Response.json({ event: await adminGetEventAccess(actor.userId) })
  } catch (error) {
    return serverError('admin/event', error)
  }
}

// { opensAt, closesAt, newQr?: true }. La primera vez (o con newQr) se genera una clave nueva:
// los carteles impresos con la anterior dejan de funcionar.
export async function PUT(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const body = (await req.json().catch(() => null)) as { opensAt?: unknown; closesAt?: unknown; newQr?: unknown } | null
  const opens = typeof body?.opensAt === 'string' ? new Date(body.opensAt) : null
  const closes = typeof body?.closesAt === 'string' ? new Date(body.closesAt) : null
  if (!opens || !closes || Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) {
    return badRequest('Elegí desde y hasta cuándo funciona el QR')
  }
  if (closes <= opens) return badRequest('El cierre tiene que ser después de la apertura')
  if (closes.getTime() - opens.getTime() > MAX_WINDOW_MS) return badRequest('Como máximo puede quedar abierto una semana')

  try {
    const current = await adminGetEventAccess(actor.userId)
    const key = !current || body?.newQr === true ? newKey() : null
    if (!(await adminSetEventAccess(actor.userId, key, opens.toISOString(), closes.toISOString()))) {
      return badRequest('No tenés permiso para esto', 403)
    }
    return Response.json({ event: await adminGetEventAccess(actor.userId) })
  } catch (error) {
    return serverError('admin/event/put', error)
  }
}
