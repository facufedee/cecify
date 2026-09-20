// Rate limit en memoria (ventana fija). Best-effort: en Vercel serverless cada
// instancia tiene su propio contador. Si hace falta algo estricto, mover a Upstash/Redis.
const hits = new Map<string, { count: number; resetAt: number }>()

export const rateLimit = (key: string, max: number, windowMs: number) => {
  const now = Date.now()

  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k)
    }
  }

  const entry = hits.get(key)
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }

  entry.count += 1
  if (entry.count > max) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { ok: true, retryAfter: 0 }
}

export const getClientIp = (req: Request) =>
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
