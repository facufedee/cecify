import { getAuth, unauthorized } from '@/lib/api-auth'
import { upsertProfile } from '@/lib/db'
import { validateProfileInput } from '@/lib/profile-schema'
import { rateLimit } from '@/lib/rate-limit'
import { isOwnPhotoUrl } from '@/lib/storage'

export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`profile:${auth.userId}`, 10, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Demasiados intentos, probá de nuevo en un momento' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const parsed = validateProfileInput(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })

  // Las fotos tienen que ser las que este usuario subio a nuestro storage
  const urls = [parsed.data.mainPhotoUrl, ...parsed.data.additionalPhotos]
  if (!urls.every((u) => isOwnPhotoUrl(u, auth.userId))) {
    return Response.json({ error: 'Fotos inválidas' }, { status: 400 })
  }

  try {
    const profile = await upsertProfile(auth.userId, parsed.data)
    return Response.json({ profileId: profile.id, profile })
  } catch (error) {
    console.error('profiles/create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
