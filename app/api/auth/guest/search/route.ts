import { guestSearch, registrationOpen } from '@/lib/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseWeddingCode } from '@/lib/wedding-code'

// Holgado: en la fiesta muchos buscan su nombre a la vez desde el mismo WiFi (cada letra es una busqueda)
const IP_MAX = 240
const WINDOW_MS = 60_000

// Pantalla de login: { q, code? } -> hasta 8 invitados que coinciden (2+ letras; nunca la lista entera) y si el registro
// de nuevos esta abierto. Sin q: solo si el registro esta abierto (para el aviso de "registro inhabilitado").
// code: el del casamiento. Sin code (la app de antes) busca en el unico casamiento; un code que no existe no encuentra
// a nadie y responde registro cerrado.
export async function POST(req: Request) {
  if (!rateLimit(`guest-search:ip:${getClientIp(req)}`, IP_MAX, WINDOW_MS).ok) {
    return Response.json({ error: 'Demasiadas búsquedas, esperá un momento' }, { status: 429 })
  }

  const body = (await req.json().catch(() => null)) as { q?: unknown; code?: unknown } | null
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 60) : ''
  const code = parseWeddingCode(body?.code)
  if (code === null) return Response.json({ error: 'El código del casamiento no es válido', code: 'WEDDING_CODE' }, { status: 400 })

  try {
    if (q.length < 2) return Response.json({ guests: [], registrationOpen: await registrationOpen(code) })
    const found = await guestSearch(q, code)
    return Response.json({ guests: found.guests, registrationOpen: found.registrationOpen ?? (await registrationOpen(code)) })
  } catch (error) {
    console.error('guest search error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
