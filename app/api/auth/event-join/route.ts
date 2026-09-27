import { isUniqueViolation } from '@/lib/admin-api'
import { generateToken } from '@/lib/auth'
import { eventJoin } from '@/lib/db'
import { canonicalPhone, eventEmail } from '@/lib/event'
import { generateCode, NAME_MAX } from '@/lib/guests'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { forgetSession } from '@/lib/session'

// Holgado por IP a proposito: en la fiesta casi todos entran desde el mismo WiFi al mismo tiempo.
// Por numero es estricto: es lo que identifica la cuenta.
const IP_MAX = 120
const PHONE_MAX = 5
const WINDOW_MS = 60_000
const MAX_CODE_ATTEMPTS = 5

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status })

// Entrada con el QR de la fiesta: { key, name, whatsapp }. Crea la cuenta o, si ese WhatsApp ya entro
// (otro celular), la recupera y cierra la sesion del dispositivo anterior.
export async function POST(req: Request) {
  const ip = rateLimit(`event-join:ip:${getClientIp(req)}`, IP_MAX, WINDOW_MS)
  if (!ip.ok) return fail('Demasiados intentos, probá de nuevo en un momento', 429)

  const body = (await req.json().catch(() => null)) as { key?: unknown; name?: unknown; whatsapp?: unknown } | null
  const key = typeof body?.key === 'string' ? body.key : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const phone = typeof body?.whatsapp === 'string' ? canonicalPhone(body.whatsapp) : null

  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return fail('Este QR no es válido', 403, { code: 'INVALID' })
  if (!name || name.length > NAME_MAX) return fail('Poné tu nombre', 400)
  if (!phone) return fail('Revisá el número de WhatsApp (con código de área)', 400)

  if (!rateLimit(`event-join:phone:${phone}`, PHONE_MAX, WINDOW_MS).ok) {
    return fail('Demasiados intentos con este número, esperá un minuto', 429)
  }

  try {
    let result: Awaited<ReturnType<typeof eventJoin>> | undefined
    for (let attempt = 1; !result; attempt++) {
      try {
        result = await eventJoin(key, name, eventEmail(phone), generateCode())
      } catch (error) {
        // El codigo interno generado ya lo tenia otro invitado (muy raro): se prueba con otro
        if (!isUniqueViolation(error) || attempt >= MAX_CODE_ATTEMPTS) throw error
      }
    }

    if (result.status !== 'ok') {
      return result.status === 'closed'
        ? fail('El QR de la fiesta todavía no está habilitado (o ya se cerró).', 403, { code: 'CLOSED' })
        : fail('Este QR ya no sirve. Pedile el nuevo a los novios o a quien organiza.', 403, { code: 'INVALID' })
    }

    // Si la cuenta ya existia se subio su version de sesion: que el token viejo deje de servir ya en esta instancia
    forgetSession(result.userId)
    const token = generateToken(result.userId, result.role, { version: result.sessionVersion })
    return Response.json({
      token,
      existing: result.existing,
      user: { id: result.userId, email: eventEmail(phone), role: result.role },
    })
  } catch (error) {
    console.error('event-join error:', error)
    return fail('Error del servidor', 500)
  }
}
