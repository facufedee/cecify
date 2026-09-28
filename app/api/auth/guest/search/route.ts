import { guestSearch, registrationOpen } from '@/lib/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

// Holgado: en la fiesta muchos buscan su nombre a la vez desde el mismo WiFi (cada letra es una busqueda)
const IP_MAX = 240
const WINDOW_MS = 60_000

// Pantalla de login: { q } -> hasta 8 invitados que coinciden (2+ letras; nunca la lista entera) y si el registro de
// nuevos esta abierto. Sin q: solo si el registro esta abierto (para el aviso de "registro inhabilitado").
export async function POST(req: Request) {
  if (!rateLimit(`guest-search:ip:${getClientIp(req)}`, IP_MAX, WINDOW_MS).ok) {
    return Response.json({ error: 'Demasiadas búsquedas, esperá un momento' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { q?: unknown } | null
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 60) : ''

  try {
    if (q.length < 2) return Response.json({ guests: [], registrationOpen: await registrationOpen() })
    const found = await guestSearch(q)
    return Response.json({ guests: found.guests, registrationOpen: found.registrationOpen ?? (await registrationOpen()) })
  } catch (error) {
    console.error('guest search error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
