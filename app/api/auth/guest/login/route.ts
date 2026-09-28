import { generateToken } from '@/lib/auth'
import { guestPinAttempt, guestPinForLogin } from '@/lib/db'
import { dummyHash, verifyPassword } from '@/lib/password'
import { PIN_RE } from '@/lib/pin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status })

const untilText = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

// Entrar con el PIN: { guestId, pin }. Funciona siempre (aunque el registro este cerrado).
// Cada nombre tiene 5 intentos: al quinto fallido queda trabado 15 minutos (lo cuenta la base, no la memoria).
export async function POST(req: Request) {
  // Ademas, por IP: frena a quien prueba "1234" en muchos nombres (holgado por el WiFi compartido de la fiesta)
  if (!rateLimit(`guest-login:ip:${getClientIp(req)}`, 60, 10 * 60_000).ok) return fail('Demasiados intentos, esperá unos minutos', 429)

  const body = (await req.json().catch(() => null)) as { guestId?: unknown; pin?: unknown } | null
  if (!isUuid(body?.guestId)) return fail('Elegí tu nombre de la lista', 400)
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!PIN_RE.test(pin)) return fail('El PIN tiene que ser de 4 números', 400)
  const guestId = body.guestId as string

  try {
    const stored = await guestPinForLogin(guestId)
    if (!stored) {
      await verifyPassword(pin, await dummyHash()) // mismo tiempo de respuesta
      return fail('Este nombre todavía no se registró', 404, { code: 'NOT_REGISTERED' })
    }
    if (stored.lockedUntil && stored.lockedUntil > new Date()) {
      return fail(`Demasiados intentos con este nombre. Probá de nuevo a las ${untilText(stored.lockedUntil)}.`, 423, { code: 'LOCKED' })
    }

    const result = await guestPinAttempt(guestId, await verifyPassword(pin, stored.hash))
    switch (result.status) {
      case 'ok':
        return Response.json({ token: generateToken(result.userId, result.role, { version: result.sessionVersion }) })
      case 'wrong':
        return fail(
          result.left === 1 ? 'PIN incorrecto. Te queda 1 intento.' : `PIN incorrecto. Te quedan ${result.left} intentos.`,
          401,
          { code: 'WRONG', left: result.left }
        )
      case 'locked':
        return fail(`Demasiados intentos con este nombre. Probá de nuevo a las ${untilText(result.until)}.`, 423, { code: 'LOCKED' })
      default:
        return fail('Este nombre todavía no se registró', 404, { code: 'NOT_REGISTERED' })
    }
  } catch (error) {
    console.error('guest login error:', error)
    return fail('Error del servidor', 500)
  }
}
