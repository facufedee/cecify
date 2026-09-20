import { getAuth, unauthorized } from '@/lib/api-auth'
import { discoverProfiles, getUserContext } from '@/lib/db'
import type { DiscoverProfile } from '@/lib/profile-schema'
import { rateLimit } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Perfiles todavia no swipeados (los excluye el servidor). ?exclude=id1,id2 evita repetir
// los que el cliente ya tiene en mano pero aun no swipeo.
export async function GET(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`discover:${auth.userId}`, 60, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Demasiadas solicitudes, probá de nuevo en un momento' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  const exclude = (new URL(req.url).searchParams.get('exclude') ?? '')
    .split(',')
    .filter((id) => UUID_RE.test(id))
    .slice(0, 50)

  try {
    const ctx = await getUserContext(auth.userId)
    if (!ctx) return unauthorized()
    if (!ctx.profile) {
      return Response.json(
        { error: 'Completá tu perfil primero', code: 'PROFILE_REQUIRED' },
        { status: 403 }
      )
    }

    const mine = new Set(ctx.profile.interests)
    const profiles: DiscoverProfile[] = (await discoverProfiles(auth.userId, exclude, 10)).map((p) => ({
      ...p,
      commonInterests: p.interests.filter((i) => mine.has(i)),
    }))

    return Response.json({ profiles })
  } catch (error) {
    console.error('profiles/discover error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
