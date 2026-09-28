import { createHash } from 'node:crypto'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { generateToken } from '@/lib/auth'
import { createSessionTransfer, redeemSessionTransfer } from '@/lib/db'
import { generateCode, normalizeCode } from '@/lib/guests'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

// Cuanto dura el codigo: lo justo para instalar la app y abrirla
const TTL_SECONDS = 15 * 60

const hash = (code: string) => createHash('sha256').update(normalizeCode(code)).digest('hex')

// Con sesion (en el navegador): pide un codigo de un solo uso para entrar en la app instalada
export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`transfer-create:${auth.userId}`, 10, 60 * 60_000).ok) {
    return Response.json({ error: 'Pediste muchos códigos, esperá un rato' }, { status: 429 })
  }

  try {
    const code = generateCode()
    const expiresAt = await createSessionTransfer(auth.userId, hash(code), auth.sessionStart, TTL_SECONDS)
    if (!expiresAt) return unauthorized()
    return Response.json({ code, expiresAt })
  } catch (error) {
    console.error('auth/transfer error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// Sin sesion (en la app instalada): { code } -> token de la misma cuenta
export async function PUT(req: Request) {
  // Holgado por IP (en la fiesta muchos comparten WiFi); el codigo tiene 31^8 combinaciones y dura 15 minutos
  if (!rateLimit(`transfer-redeem:${getClientIp(req)}`, 30, 10 * 60_000).ok) {
    return Response.json({ error: 'Demasiados intentos, esperá unos minutos' }, { status: 429 })
  }

  const raw = ((await req.json().catch(() => null)) as { code?: unknown } | null)?.code
  const code = typeof raw === 'string' ? normalizeCode(raw) : ''
  if (!/^[A-Z0-9]{8}$/.test(code)) return Response.json({ error: 'Revisá el código (son 8 letras y números)' }, { status: 400 })

  try {
    const session = await redeemSessionTransfer(hash(code))
    if (!session) {
      return Response.json({ error: 'El código no sirve: ya se usó o venció. Pedí uno nuevo desde el navegador.' }, { status: 401 })
    }
    const token = generateToken(session.userId, session.role, { version: session.sessionVersion, sessionStart: session.sessionStart })
    return Response.json({ token })
  } catch (error) {
    console.error('auth/transfer redeem error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
