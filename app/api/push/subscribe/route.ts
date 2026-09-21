import { getAuth, unauthorized } from '@/lib/api-auth'
import { deletePushSubscription, savePushSubscription } from '@/lib/db'
import { pushConfigured } from '@/lib/push-server'
import { rateLimit } from '@/lib/rate-limit'

// Extrae y valida la suscripcion que entrega el navegador (PushSubscription.toJSON())
const parseSubscription = (raw: unknown) => {
  const s = (raw ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  const { endpoint } = s
  const p256dh = s.keys?.p256dh
  const auth = s.keys?.auth
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 2000) return null
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null
  return { endpoint, keys: { p256dh, auth } }
}

// El cliente pregunta si el servidor tiene las notificaciones configuradas
export async function GET(req: Request) {
  const session = await getAuth(req)
  if (!session) return unauthorized()
  return Response.json({ configured: pushConfigured() })
}

// Registra las notificaciones de ESTE dispositivo para la persona con sesion
export async function POST(req: Request) {
  const session = await getAuth(req)
  if (!session) return unauthorized()

  if (!pushConfigured()) return Response.json({ error: 'Las notificaciones no están disponibles' }, { status: 503 })
  if (!rateLimit(`push-subscribe:${session.userId}`, 20, 60 * 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null
  const subscription = parseSubscription(body?.subscription)
  if (!subscription) return Response.json({ error: 'Suscripción inválida' }, { status: 400 })

  try {
    await savePushSubscription(session.userId, subscription, req.headers.get('user-agent'))
    return Response.json({ ok: true })
  } catch (error) {
    console.error('push/subscribe error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// Da de baja las notificaciones de un dispositivo
export async function DELETE(req: Request) {
  const session = await getAuth(req)
  if (!session) return unauthorized()

  if (!rateLimit(`push-subscribe:${session.userId}`, 20, 60 * 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const endpoint = ((await req.json().catch(() => null)) as { endpoint?: unknown } | null)?.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > 2000) {
    return Response.json({ error: 'Dispositivo inválido' }, { status: 400 })
  }

  try {
    await deletePushSubscription(session.userId, endpoint) // si ya no estaba, da igual
    return Response.json({ ok: true })
  } catch (error) {
    console.error('push/unsubscribe error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
