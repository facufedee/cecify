import { after } from 'next/server'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { getUserContext, recordSwipe } from '@/lib/db'
import { emitTo } from '@/lib/realtime'
import { rateLimit } from '@/lib/rate-limit'
import { UUID_RE } from '@/lib/validators'

export async function POST(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`swipe:${auth.userId}`, 30, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Vas muy rápido, esperá unos segundos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { profileId, action } = (body ?? {}) as { profileId?: unknown; action?: unknown }
  if (
    typeof profileId !== 'string' ||
    !UUID_RE.test(profileId) ||
    (action !== 'like' && action !== 'skip')
  ) {
    return Response.json({ error: 'Datos inválidos' }, { status: 400 })
  }

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
        { error: 'Elegiste usar solo el muro: activá Descubrir en tu perfil para hacer match', code: 'MATCH_DISABLED' },
        { status: 403 }
      )
    }

    const result = await recordSwipe(auth.userId, profileId, action)
    if (result.status === 'not_found') {
      return Response.json({ error: 'Perfil no encontrado' }, { status: 404 })
    }
    if (result.status === 'self') {
      return Response.json({ error: 'No podés swipearte a vos mismo' }, { status: 400 })
    }

    if (result.matched) {
      const me = ctx.profile
      after(() =>
        emitTo(result.target.userId, 'match:created', {
          conversationId: result.conversationId,
          name: me.name,
          photo: me.mainPhotoUrl,
        })
      )
    }

    return Response.json({
      matchCreated: result.matched,
      matchId: result.matchId,
      conversationId: result.conversationId,
      matchedProfile: result.matched
        ? { name: result.target.name, mainPhotoUrl: result.target.mainPhotoUrl }
        : undefined,
    })
  } catch (error) {
    console.error('swipes/create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
