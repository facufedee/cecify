import { eventSearchGuests } from '@/lib/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

// Holgado: en la fiesta muchos buscan su nombre a la vez desde el mismo WiFi (cada letra es una busqueda)
const IP_MAX = 240
const WINDOW_MS = 60_000

// Buscar el propio nombre en la lista: { key, q }. Necesita el QR de la fiesta (clave vigente) y 2+ letras;
// nunca devuelve la lista entera. Va por POST para que la clave no quede en la URL.
export async function POST(req: Request) {
  if (!rateLimit(`guest-list:ip:${getClientIp(req)}`, IP_MAX, WINDOW_MS).ok) {
    return Response.json({ error: 'Demasiadas búsquedas, esperá un momento' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { key?: unknown; q?: unknown } | null
  const key = typeof body?.key === 'string' ? body.key : ''
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 60) : ''
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return Response.json({ error: 'Este QR no es válido', code: 'INVALID' }, { status: 403 })
  if (q.length < 2) return Response.json({ guests: [] })

  try {
    const result = await eventSearchGuests(key, q)
    if (result.status !== 'ok') {
      return result.status === 'closed'
        ? Response.json({ error: 'El QR de la fiesta todavía no está habilitado (o ya se cerró).', code: 'CLOSED' }, { status: 403 })
        : Response.json({ error: 'Este QR ya no sirve. Pedile el nuevo a los novios o a quien organiza.', code: 'INVALID' }, { status: 403 })
    }
    return Response.json({ guests: result.guests })
  } catch (error) {
    console.error('guest-list search error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
