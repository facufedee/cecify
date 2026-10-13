import { generateToken } from '@/lib/auth'
import { guestRegister } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { PIN_RE } from '@/lib/pin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'
import { parseWeddingCode } from '@/lib/wedding-code'

const fail = (error: string, status: number, code?: string) => Response.json({ error, ...(code ? { code } : {}) }, { status })

// Primera vez: { guestId, pin, code? } (code: el del casamiento; sin code, el unico casamiento). Solo con el registro habilitado por un organizador. Cada nombre se registra una vez.
export async function POST(req: Request) {
  if (!rateLimit(`guest-register:ip:${getClientIp(req)}`, 60, 60_000).ok) return fail('Demasiados intentos, esperá un momento', 429)

  const body = (await req.json().catch(() => null)) as { guestId?: unknown; pin?: unknown; code?: unknown } | null
  const code = parseWeddingCode(body?.code)
  if (code === null) return fail('El código del casamiento no es válido', 400, 'WEDDING_CODE')
  if (!isUuid(body?.guestId)) return fail('Elegí tu nombre de la lista', 400)
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  if (!PIN_RE.test(pin)) return fail('El PIN tiene que ser de 4 números', 400)

  try {
    const result = await guestRegister(body.guestId as string, await hashPassword(pin), code)
    switch (result.status) {
      case 'ok':
        return Response.json({ token: generateToken(result.userId, result.role, { version: result.sessionVersion }) })
      case 'closed':
        return fail('El registro está momentáneamente inhabilitado.', 403, 'CLOSED')
      case 'taken':
        return fail('Este nombre ya está registrado: entrá con tu PIN.', 409, 'TAKEN')
      default:
        return fail('No encontramos ese nombre en la lista', 404)
    }
  } catch (error) {
    console.error('guest register error:', error)
    return fail('Error del servidor', 500)
  }
}
