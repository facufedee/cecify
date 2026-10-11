import { weddingByCode } from '@/lib/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseWeddingCode } from '@/lib/wedding-code'

// Holgado (el WiFi de la fiesta es compartido) pero frena a quien prueba codigos al azar
const IP_MAX = 60
const WINDOW_MS = 60_000

// Entrada de invitados: ?code=XXXXXX -> { partnerA, partnerB, registrationOpen }. 404 = el codigo no existe.
// Publico: nunca devuelve ids.
export async function GET(req: Request) {
  if (!rateLimit(`wedding-by-code:ip:${getClientIp(req)}`, IP_MAX, WINDOW_MS).ok) {
    return Response.json({ error: 'Demasiados intentos, esperá un momento' }, { status: 429 })
  }

  const code = parseWeddingCode(new URL(req.url).searchParams.get('code'))
  if (!code) return Response.json({ error: 'El código del casamiento no es válido', code: 'WEDDING_CODE' }, { status: 400 })

  try {
    const wedding = await weddingByCode(code)
    if (!wedding) return Response.json({ error: 'No encontramos ese casamiento', code: 'NOT_FOUND' }, { status: 404 })
    return Response.json({ partnerA: wedding.partnerA, partnerB: wedding.partnerB, registrationOpen: wedding.registrationOpen })
  } catch (error) {
    console.error('weddings/by-code error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
