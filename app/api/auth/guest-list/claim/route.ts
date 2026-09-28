import { generateToken } from '@/lib/auth'
import { verifyCaptcha } from '@/lib/captcha'
import { eventClaimGuest } from '@/lib/db'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

const fail = (error: string, status: number, code?: string) => Response.json({ error, ...(code ? { code } : {}) }, { status })

// Elegirse de la lista: { key, guestId, captcha }. Cada nombre se elige una sola vez: si ya entro alguien, queda
// bloqueado (cambio de celular: "codigo para la app" o que un organizador libere el nombre).
export async function POST(req: Request) {
  const ipAddr = getClientIp(req)
  if (!rateLimit(`guest-claim:ip:${ipAddr}`, 60, 60_000).ok) return fail('Demasiados intentos, esperá un momento', 429)

  const body = (await req.json().catch(() => null)) as { key?: unknown; guestId?: unknown; captcha?: unknown } | null
  const key = typeof body?.key === 'string' ? body.key : ''
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return fail('Este QR no es válido', 403, 'INVALID')
  if (!isUuid(body?.guestId)) return fail('Elegí tu nombre de la lista', 400)
  if (!(await verifyCaptcha(body?.captcha, ipAddr))) return fail('Completá la verificación "no soy un robot"', 400, 'CAPTCHA')

  try {
    const result = await eventClaimGuest(key, body.guestId as string)
    switch (result.status) {
      case 'ok': {
        const token = generateToken(result.userId, result.role, { version: result.sessionVersion })
        return Response.json({ token })
      }
      case 'taken':
        return fail(
          'Alguien ya entró con este nombre. Si sos vos desde otro celular, usá "Generar código para la app" en el otro, o pedile a un organizador que libere tu nombre.',
          409,
          'TAKEN'
        )
      case 'not_found':
        return fail('No encontramos ese nombre en la lista', 404)
      case 'closed':
        return fail('El QR de la fiesta todavía no está habilitado (o ya se cerró).', 403, 'CLOSED')
      default:
        return fail('Este QR ya no sirve. Pedile el nuevo a los novios o a quien organiza.', 403, 'INVALID')
    }
  } catch (error) {
    console.error('guest-list claim error:', error)
    return fail('Error del servidor', 500)
  }
}
