import { findGuest, upsertUser } from '@/lib/db'
import { generateToken } from '@/lib/auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// El limite por IP es holgado a proposito: en la fiesta muchos invitados comparten
// el mismo WiFi (misma IP publica). La proteccion real contra fuerza bruta es por email.
const IP_MAX = 60
const EMAIL_MAX = 5
const WINDOW_MS = 60_000

const tooMany = (retryAfter: number) =>
  Response.json(
    { error: 'Demasiados intentos, probá de nuevo en un momento' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )

export async function POST(req: Request) {
  const ip = rateLimit(`login:ip:${getClientIp(req)}`, IP_MAX, WINDOW_MS)
  if (!ip.ok) return tooMany(ip.retryAfter)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { email, code } = (body ?? {}) as { email?: unknown; code?: unknown }
  if (typeof email !== 'string' || typeof code !== 'string') {
    return Response.json({ error: 'Email y código son obligatorios' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()
  const normalizedCode = code.replace(/[\s-]/g, '').toUpperCase()

  if (normalizedEmail.length > 255 || !EMAIL_RE.test(normalizedEmail)) {
    return Response.json({ error: 'Email inválido' }, { status: 400 })
  }
  if (normalizedCode.length < 4 || normalizedCode.length > 50) {
    return Response.json({ error: 'Código inválido' }, { status: 400 })
  }

  const perEmail = rateLimit(`login:email:${normalizedEmail}`, EMAIL_MAX, WINDOW_MS)
  if (!perEmail.ok) return tooMany(perEmail.retryAfter)

  try {
    const guest = await findGuest(normalizedEmail, normalizedCode)
    if (!guest) {
      return Response.json({ error: 'Email o código incorrecto' }, { status: 401 })
    }

    const user = await upsertUser(normalizedEmail)
    const token = generateToken(user.id, user.role, { version: user.sessionVersion })
    return Response.json({
      token,
      user: { id: user.id, email: user.email, role: user.role },
    })
  } catch (error) {
    console.error('login error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
