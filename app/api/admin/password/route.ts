import { adminOnly, badRequest, serverError } from '@/lib/admin-api'
import { generateToken } from '@/lib/auth'
import { adminAccountOf, setAdminPassword } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/password'
import { passwordProblem, PASSWORD_MAX } from '@/lib/password-rules'
import { rateLimit } from '@/lib/rate-limit'
import { forgetSession } from '@/lib/session'

// Mi cuenta: { username, changedAt } o { username: null } si entro con codigo o QR (no tiene contraseña)
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor
  try {
    const account = await adminAccountOf(actor.userId)
    return Response.json(account ? { username: account.username, changedAt: account.changedAt } : { username: null })
  } catch (error) {
    return serverError('admin/password', error)
  }
}

// Cambia la contraseña: { current, next }. Cierra las demas sesiones y devuelve un token nuevo para este dispositivo.
export async function POST(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  if (!rateLimit(`password-change:${actor.userId}`, 5, 15 * 60_000).ok) {
    return badRequest('Demasiados intentos, esperá unos minutos', 429)
  }

  const body = (await req.json().catch(() => null)) as { current?: unknown; next?: unknown } | null
  const current = typeof body?.current === 'string' ? body.current : ''
  const next = typeof body?.next === 'string' ? body.next : ''
  if (!current || current.length > PASSWORD_MAX) return badRequest('Escribí tu contraseña actual')
  const problem = passwordProblem(next)
  if (problem) return badRequest(problem)
  if (next === current) return badRequest('La contraseña nueva tiene que ser distinta de la actual')

  try {
    const account = await adminAccountOf(actor.userId)
    if (!account) return badRequest('Tu cuenta entra con código o QR: no tiene contraseña', 409)
    if (!(await verifyPassword(current, account.hash))) return badRequest('La contraseña actual no es correcta', 403)

    const version = await setAdminPassword(actor.userId, await hashPassword(next))
    if (version === null) return badRequest('Tu cuenta no tiene contraseña', 409)
    forgetSession(actor.userId)
    return Response.json({ ok: true, token: generateToken(actor.userId, actor.role, { version }) })
  } catch (error) {
    return serverError('admin/password/post', error)
  }
}
