import { generateToken } from '@/lib/auth'
import { verifyCaptcha } from '@/lib/captcha'
import { adminAccountForLogin } from '@/lib/db'
import { dummyHash, verifyPassword } from '@/lib/password'
import { PASSWORD_MAX, USERNAME_RE } from '@/lib/password-rules'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

// Estricto: es la puerta al panel con todos los permisos
const IP_MAX = 20
const USER_MAX = 5
const WINDOW_MS = 15 * 60_000

const tooMany = (retryAfter: number) =>
  Response.json(
    { error: 'Demasiados intentos, esperá unos minutos' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )

// Mismo mensaje para usuario inexistente y contraseña incorrecta: no se puede averiguar que usuarios existen
const wrong = () => Response.json({ error: 'Usuario o contraseña incorrectos' }, { status: 401 })

// Login de organizador: { username, password, captcha }
export async function POST(req: Request) {
  const ipAddr = getClientIp(req)
  const ip = rateLimit(`admin-login:ip:${ipAddr}`, IP_MAX, WINDOW_MS)
  if (!ip.ok) return tooMany(ip.retryAfter)

  const body = (await req.json().catch(() => null)) as { username?: unknown; password?: unknown; captcha?: unknown } | null
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!USERNAME_RE.test(username) || !password || password.length > PASSWORD_MAX) return wrong()

  const perUser = rateLimit(`admin-login:user:${username}`, USER_MAX, WINDOW_MS)
  if (!perUser.ok) return tooMany(perUser.retryAfter)

  if (!(await verifyCaptcha(body?.captcha, ipAddr))) {
    return Response.json({ error: 'Completá la verificación "no soy un robot"', code: 'CAPTCHA' }, { status: 400 })
  }

  try {
    const account = await adminAccountForLogin(username)
    const ok = await verifyPassword(password, account?.hash ?? (await dummyHash()))
    if (!account || !ok) return wrong()

    const token = generateToken(account.userId, account.role, { version: account.sessionVersion })
    return Response.json({ token, user: { id: account.userId, role: account.role } })
  } catch (error) {
    console.error('admin-login error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
