import { isUniqueViolation } from '@/lib/admin-api'
import { generateToken } from '@/lib/auth'
import { eventJoin } from '@/lib/db'
import { verifyCaptcha } from '@/lib/captcha'
import { canonicalInstagram, canonicalPhone, eventEmail, instagramEmail } from '@/lib/event'
import { generateCode, NAME_MAX } from '@/lib/guests'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { forgetSession } from '@/lib/session'

// Holgado por IP a proposito: en la fiesta casi todos entran desde el mismo WiFi al mismo tiempo.
// Por WhatsApp o Instagram es estricto: es lo que identifica la cuenta.
const IP_MAX = 120
const IDENTITY_MAX = 5
const WINDOW_MS = 60_000
const MAX_CODE_ATTEMPTS = 5

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status })

// Entrada con el QR de la fiesta: { key, name, whatsapp | instagram, captcha }. Crea la cuenta o, si ese
// WhatsApp o Instagram ya entro (otro celular), la recupera y cierra la sesion del dispositivo anterior.
export async function POST(req: Request) {
  const ipAddr = getClientIp(req)
  const ip = rateLimit(`event-join:ip:${ipAddr}`, IP_MAX, WINDOW_MS)
  if (!ip.ok) return fail('Demasiados intentos, probá de nuevo en un momento', 429)

  const body = (await req.json().catch(() => null)) as
    | { key?: unknown; name?: unknown; whatsapp?: unknown; instagram?: unknown; captcha?: unknown }
    | null
  const key = typeof body?.key === 'string' ? body.key : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const byInstagram = typeof body?.instagram === 'string'

  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return fail('Este QR no es válido', 403, { code: 'INVALID' })
  if (!name || name.length > NAME_MAX) return fail('Poné tu nombre', 400)

  // Con que dato se identifica: WhatsApp o Instagram (uno de los dos)
  let email: string
  if (byInstagram) {
    const handle = canonicalInstagram(body.instagram as string)
    if (!handle) return fail('Revisá tu usuario de Instagram', 400)
    email = instagramEmail(handle)
  } else {
    const phone = typeof body?.whatsapp === 'string' ? canonicalPhone(body.whatsapp) : null
    if (!phone) return fail('Revisá el número de WhatsApp (con código de área)', 400)
    email = eventEmail(phone)
  }

  if (!rateLimit(`event-join:id:${email}`, IDENTITY_MAX, WINDOW_MS).ok) {
    return fail('Demasiados intentos con este dato, esperá un minuto', 429)
  }
  if (!(await verifyCaptcha(body?.captcha, ipAddr))) {
    return fail('Completá la verificación "no soy un robot"', 400, { code: 'CAPTCHA' })
  }

  try {
    let result: Awaited<ReturnType<typeof eventJoin>> | undefined
    for (let attempt = 1; !result; attempt++) {
      try {
        result = await eventJoin(key, name, email, generateCode())
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
      user: { id: result.userId, email, role: result.role },
    })
  } catch (error) {
    console.error('event-join error:', error)
    return fail('Error del servidor', 500)
  }
}
