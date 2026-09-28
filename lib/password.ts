// Contraseñas de las cuentas de organizador: scrypt con sal aleatoria. Solo servidor (y el script create:admin).
// Sin imports del proyecto: lo carga tambien `node scripts/create-admin.mjs` directamente. Las reglas
// (largo minimo, formato del usuario) estan en lib/password-rules.ts.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 2 ** 15
const R = 8
const P = 1
const KEYLEN = 64
const MAXMEM = 64 * 1024 * 1024

const derive = (password: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)))
  )

// Formato: scrypt$N$r$p$<sal base64>$<hash base64> (guarda los parametros para poder subirlos mas adelante)
export const hashPassword = async (password: string) => {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export const verifyPassword = async (password: string, stored: string) => {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p))
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// Hash de relleno: si el usuario no existe se verifica igual contra esto, asi la respuesta tarda lo mismo
// y no se puede averiguar que usuarios existen midiendo el tiempo.
let dummy: Promise<string> | null = null
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')))

