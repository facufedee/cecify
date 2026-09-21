import jwt from 'jsonwebtoken'
import type { Role } from '@/lib/roles'

const JWT_SECRET = process.env.JWT_SECRET!

// Cada token dura 12 h y se renueva solo mientras la persona usa la app (/api/auth/refresh),
// pero una sesion no puede pasar de MAX_SESSION_SECONDS desde el inicio de sesion real.
export const TOKEN_TTL_SECONDS = 12 * 60 * 60
export const MAX_SESSION_SECONDS = 72 * 60 * 60

export type TokenPayload = {
  userId: string
  role: string
  v?: number // version de sesion con la que se emitio (si cambia en la base, el token deja de servir)
  sa?: number // inicio de la sesion (segundos): se conserva al renovar
  iat?: number
  exp?: number
}

export const generateToken = (
  userId: string,
  role: Role = 'guest',
  opts: { version?: number; sessionStart?: number } = {}
) => {
  const now = Math.floor(Date.now() / 1000)
  return jwt.sign(
    { userId, role, v: opts.version ?? 0, sa: opts.sessionStart ?? now },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_SECONDS }
  )
}

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  } catch {
    return null
  }
}
