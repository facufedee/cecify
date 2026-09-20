import jwt from 'jsonwebtoken'
import type { Role } from '@/lib/roles'

const JWT_SECRET = process.env.JWT_SECRET!

export const generateToken = (userId: string, role: Role = 'guest') => {
  return jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn: '12h' }
  )
}

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET) as {
      userId: string
      role: string
    }
  } catch {
    return null
  }
}
