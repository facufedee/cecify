import { beforeEach, describe, expect, it, vi } from 'vitest'

// auth.ts lee JWT_SECRET al cargarse: hay que fijarlo antes de importar nada
vi.hoisted(() => {
  process.env.JWT_SECRET = 'secreto-de-prueba'
})

vi.mock('@/lib/db', () => ({ getSessionInfo: vi.fn(), getUserRole: vi.fn() }))

import jwt from 'jsonwebtoken'
import { getAuth, requireRole } from '@/lib/api-auth'
import { generateToken, MAX_SESSION_SECONDS, TOKEN_TTL_SECONDS, verifyToken } from '@/lib/auth'
import { getSessionInfo, getUserRole } from '@/lib/db'
import { clearSessionCache, forgetSession, loadSession, SESSION_CACHE_MS } from '@/lib/session'

const req = (token?: string) =>
  new Request('http://x/api', { headers: token ? { authorization: `Bearer ${token}` } : {} })

const info = vi.mocked(getSessionInfo)
const role = vi.mocked(getUserRole)

beforeEach(() => {
  clearSessionCache()
  info.mockReset()
  role.mockReset()
})

describe('token', () => {
  it('lleva version, inicio de sesion y dura 12 h', () => {
    const t = verifyToken(generateToken('u1', 'admin', { version: 3 }))!
    expect(t).toMatchObject({ userId: 'u1', role: 'admin', v: 3 })
    expect(t.sa).toBeGreaterThan(0)
    expect(t.exp! - t.iat!).toBe(TOKEN_TTL_SECONDS)
  })

  it('al renovar conserva el inicio de la sesion original', () => {
    const t = verifyToken(generateToken('u1', 'guest', { version: 1, sessionStart: 1000 }))!
    expect(t.sa).toBe(1000)
  })

  it('rechaza firmas ajenas y basura', () => {
    expect(verifyToken(jwt.sign({ userId: 'u1' }, 'otro-secreto'))).toBeNull()
    expect(verifyToken('basura')).toBeNull()
  })
})

describe('cache de sesion', () => {
  it('no vuelve a la base dentro de la ventana y si despues', async () => {
    const loader = vi.fn().mockResolvedValue({ version: 0, role: 'guest' })
    await loadSession('a', loader, 1000)
    await loadSession('a', loader, 1000 + SESSION_CACHE_MS - 1)
    expect(loader).toHaveBeenCalledTimes(1)
    await loadSession('a', loader, 1000 + SESSION_CACHE_MS + 1)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('forgetSession obliga a consultar de nuevo (asi una revocacion rige al instante en esta instancia)', async () => {
    const loader = vi.fn().mockResolvedValueOnce({ version: 0, role: 'guest' }).mockResolvedValueOnce({ version: 1, role: 'guest' })
    expect((await loadSession('a', loader, 1000))?.version).toBe(0)
    forgetSession('a')
    expect((await loadSession('a', loader, 1001))?.version).toBe(1)
  })

  it('tambien recuerda que un usuario no existe', async () => {
    const loader = vi.fn().mockResolvedValue(null)
    expect(await loadSession('x', loader, 1000)).toBeNull()
    expect(await loadSession('x', loader, 1001)).toBeNull()
    expect(loader).toHaveBeenCalledTimes(1)
  })
})

describe('getAuth', () => {
  it('sin token o con token invalido no toca la base', async () => {
    expect(await getAuth(req())).toBeNull()
    expect(await getAuth(req('basura'))).toBeNull()
    expect(info).not.toHaveBeenCalled()
  })

  it('acepta una sesion vigente y devuelve el rol ACTUAL de la base, no el del token', async () => {
    info.mockResolvedValue({ version: 2, role: 'admin' })
    const auth = await getAuth(req(generateToken('u1', 'guest', { version: 2 })))
    expect(auth).toMatchObject({ userId: 'u1', role: 'admin', version: 2 })
  })

  it('rechaza si la version cambio (sesiones revocadas)', async () => {
    info.mockResolvedValue({ version: 3, role: 'guest' })
    expect(await getAuth(req(generateToken('u1', 'guest', { version: 2 })))).toBeNull()
  })

  it('rechaza si el usuario ya no existe', async () => {
    info.mockResolvedValue(null)
    expect(await getAuth(req(generateToken('u1', 'guest')))).toBeNull()
  })

  it('un token anterior a las sesiones revocables (sin version) vale mientras la version sea 0', async () => {
    const legacy = jwt.sign({ userId: 'u1', role: 'guest' }, 'secreto-de-prueba', { expiresIn: 60 })
    info.mockResolvedValue({ version: 0, role: 'guest' })
    expect(await getAuth(req(legacy))).toMatchObject({ userId: 'u1' })
    clearSessionCache()
    info.mockResolvedValue({ version: 1, role: 'guest' })
    expect(await getAuth(req(legacy))).toBeNull()
  })

  it('el inicio de sesion sale del token; en uno viejo, de cuando se emitio', async () => {
    info.mockResolvedValue({ version: 0, role: 'guest' })
    expect((await getAuth(req(generateToken('u1', 'guest', { sessionStart: 12345 }))))?.sessionStart).toBe(12345)
    const legacy = jwt.sign({ userId: 'u1', role: 'guest' }, 'secreto-de-prueba', { expiresIn: 60 })
    const iat = (jwt.decode(legacy) as { iat: number }).iat
    clearSessionCache()
    expect((await getAuth(req(legacy)))?.sessionStart).toBe(iat)
  })

  it('el tope de la sesion es de 72 h', () => {
    expect(MAX_SESSION_SECONDS).toBe(72 * 3600)
  })
})

describe('requireRole', () => {
  it('lee el rol directo de la base (sin cache): quitar un permiso rige al instante', async () => {
    info.mockResolvedValue({ version: 0, role: 'admin' }) // la cache todavia dice admin
    role.mockResolvedValue('guest') // pero en la base ya no lo es
    const res = await requireRole(req(generateToken('u1', 'admin')), ['admin', 'superadmin'])
    expect(res).toBeInstanceOf(Response)
    expect((res as Response).status).toBe(403)
  })

  it('deja pasar a quien tiene el rol y responde 401 si la sesion no vale', async () => {
    info.mockResolvedValue({ version: 0, role: 'admin' })
    role.mockResolvedValue('admin')
    expect(await requireRole(req(generateToken('u1', 'admin')), ['admin'])).toEqual({ userId: 'u1', role: 'admin' })

    clearSessionCache()
    info.mockResolvedValue(null)
    expect(((await requireRole(req(generateToken('u1', 'admin')), ['admin'])) as Response).status).toBe(401)
  })
})
