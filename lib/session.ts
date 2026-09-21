// Comprobacion de que una sesion sigue vigente: el usuario existe y su version de sesion no cambio.
// Se guarda en memoria unos segundos para no ir a la base en cada pedido; al revocar sesiones se olvida
// enseguida en esta instancia (otras instancias pueden tardar hasta SESSION_CACHE_MS en enterarse).
import type { Role } from '@/lib/roles'

export const SESSION_CACHE_MS = 10_000
const MAX_ENTRIES = 5000

export type SessionInfo = { version: number; role: Role }
export type SessionLoader = (userId: string) => Promise<SessionInfo | null>

type Entry = { info: SessionInfo | null; until: number }
const cache = new Map<string, Entry>()

export const loadSession = async (
  userId: string,
  loader: SessionLoader,
  now: number = Date.now()
): Promise<SessionInfo | null> => {
  const hit = cache.get(userId)
  if (hit && hit.until > now) return hit.info

  const info = await loader(userId)

  if (cache.size >= MAX_ENTRIES) {
    // Poda simple: primero lo vencido; si sigue lleno, todo
    for (const [k, e] of cache) if (e.until <= now) cache.delete(k)
    if (cache.size >= MAX_ENTRIES) cache.clear()
  }
  cache.set(userId, { info, until: now + SESSION_CACHE_MS })
  return info
}

export const forgetSession = (userId: string) => {
  cache.delete(userId)
}

export const clearSessionCache = () => cache.clear()
