import { getAuth, unauthorized } from '@/lib/api-auth'
import { discoverProfiles, getUserContext, skippedCount } from '@/lib/db'
import type { DiscoverProfile } from '@/lib/profile-schema'
import { rateLimit } from '@/lib/rate-limit'
import { UUID_RE } from '@/lib/validators'

// Perfiles todavia no swipeados (los excluye el servidor). ?exclude=id1,id2 evita repetir
// los que el cliente ya tiene en mano pero aun no swipeo.
export async function GET(req: Request) {
  const auth = await getAuth(req)
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

    if (!ctx.profile.wantsMatch) {
      return Response.json(
        { error: 'Elegiste usar solo el muro', code: 'MATCH_DISABLED' },
        { status: 403 }
      )
    }

    const mine = new Set(ctx.profile.interests)
    const profiles: DiscoverProfile[] = (await discoverProfiles(auth.userId, exclude, 10)).map((p) => ({
      ...p,
      commonInterests: p.interests.filter((i) => mine.has(i)),
    }))

    // Sin mas perfiles: cuantos de los que paso puede volver a ver
    // (si falla, el mazo vacio se muestra igual, sin el boton de volver a verlos)
    const skipped =
      profiles.length === 0
        ? await skippedCount(auth.userId).catch((error) => {
            console.warn('discover skipped_count:', error instanceof Error ? error.message : error)
            return 0
          })
        : 0
    return Response.json({ profiles, skipped })
  } catch (error) {
    console.error('profiles/discover error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
