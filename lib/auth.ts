import jwt from 'jsonwebtoken'
import type { Role } from '@/lib/roles'

// Cada token dura 12 h y se renueva solo mientras la persona usa la app (/api/auth/refresh),
// pero una sesion no puede pasar de MAX_SESSION_SECONDS desde el inicio de sesion real.
export const TOKEN_TTL_SECONDS = 12 * 60 * 60
export const MAX_SESSION_SECONDS = 72 * 60 * 60

// Unico algoritmo aceptado (tambien lo tiene que usar cecify-socket). Fijarlo evita que un token
// firmado con otro algoritmo pase la verificacion.
const ALGORITHM = 'HS256'
const MIN_SECRET_LENGTH = 32

// Se lee al usarlo (no al importar) para que el build no dependa de las variables de entorno.
// Sin secreto falla con un mensaje claro en vez de un error generico de jsonwebtoken.
const secret = () => {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('Falta JWT_SECRET (generalo con: openssl rand -hex 32)')
  if (process.env.NODE_ENV === 'production' && value.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET es muy corto: en produccion tiene que tener al menos ${MIN_SECRET_LENGTH} caracteres`)
  }
  return value
}

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
    secret(),
    { algorithm: ALGORITHM, expiresIn: TOKEN_TTL_SECONDS }
  )
}

export const verifyToken = (token: string): TokenPayload | null => {
  // Fuera del try: una configuracion rota tiene que verse, no pasar por "token invalido"
  const key = secret()
  try {
    const payload = jwt.verify(token, key, { algorithms: [ALGORITHM] })
    if (typeof payload !== 'object' || typeof payload.userId !== 'string') return null
    return payload as TokenPayload
  } catch {
    return null
  }
}
