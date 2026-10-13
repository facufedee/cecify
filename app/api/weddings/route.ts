import { generateToken } from '@/lib/auth'
import { verifyCaptcha } from '@/lib/captcha'
import { createWedding } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { parseNewWedding, PARTNER_NAMES_ERROR, USERNAME_ERROR } from '@/lib/wedding-code'

// Intentos (incluye los que tienen un error de tipeo) y altas que llegan a la base, por IP
const ATTEMPT_MAX = 20
const ATTEMPT_WINDOW_MS = 15 * 60_000
const CREATE_MAX = 5
const CREATE_WINDOW_MS = 60 * 60_000

// Apagado por defecto: mientras la app de invitados no mande el codigo del casamiento, un segundo casamiento
// dejaria sin entrada a los invitados del primero (sin codigo se usa "el unico casamiento").
const signupEnabled = () => process.env.WEDDING_SIGNUP_ENABLED === '1'

const tooMany = (retryAfter: number) =>
  Response.json(
    { error: 'Demasiados intentos, esperá unos minutos' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )

const fail = (error: string, status: number, code?: string) => Response.json({ error, ...(code ? { code } : {}) }, { status })

// Crear un casamiento: { partnerA, partnerB, username, password, captcha }. Crea el codigo y la cuenta del dueño
// (superadmin de ese casamiento, entra en /login/admin) y devuelve { token, code, user } con la sesion ya iniciada.
export async function POST(req: Request) {
  if (!signupEnabled()) return fail('Todavía no se pueden crear casamientos', 403, 'SIGNUP_DISABLED')

  const ipAddr = getClientIp(req)
  const attempts = rateLimit(`wedding-create:ip:${ipAddr}`, ATTEMPT_MAX, ATTEMPT_WINDOW_MS)
  if (!attempts.ok) return tooMany(attempts.retryAfter)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const input = parseNewWedding(body)
  if (!input.ok) return fail(input.error, 400)

  if (!(await verifyCaptcha(body?.captcha, ipAddr))) {
    return fail('Completá la verificación "no soy un robot"', 400, 'CAPTCHA')
  }

  // El estricto cuenta solo las altas que llegan a la base (no los errores de tipeo)
  const creations = rateLimit(`wedding-create:ok:${ipAddr}`, CREATE_MAX, CREATE_WINDOW_MS)
  if (!creations.ok) return tooMany(creations.retryAfter)

  const { partnerA, partnerB, username, password } = input.value
  try {
    const result = await createWedding(partnerA, partnerB, username, await hashPassword(password))
    switch (result.status) {
      case 'ok': {
        // La cuenta recien creada: superadmin con la version de sesion inicial (0). Sin releerla, asi un error
        // despues del alta no esconde el codigo de un casamiento que ya existe.
        const token = generateToken(result.userId, 'superadmin', { version: 0 })
        return Response.json({ token, code: result.code, user: { id: result.userId, role: 'superadmin' } })
      }
      case 'username_taken':
        return fail('Ese usuario ya existe: elegí otro', 409, 'USERNAME_TAKEN')
      case 'invalid_username':
        return fail(USERNAME_ERROR, 400)
      default:
        return fail(PARTNER_NAMES_ERROR, 400)
    }
  } catch (error) {
    console.error('weddings/create error:', error)
    return fail('Error del servidor', 500)
  }
}
