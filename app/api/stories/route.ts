import { getAuth, unauthorized } from '@/lib/api-auth'
import { createStory, listStories, listStoryRings } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isOwnPhotoUrl } from '@/lib/storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAPTION_MAX = 150

// Sin parametros: los anillos (un autor por renglon). Con ?author=<id>: sus historias vigentes.
export async function GET(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const author = new URL(req.url).searchParams.get('author')
  if (author && !UUID_RE.test(author)) {
    return Response.json({ error: 'Autor inválido' }, { status: 400 })
  }

  try {
    if (author) return Response.json({ stories: await listStories(auth.userId, author) })
    return Response.json({ rings: await listStoryRings(auth.userId) })
  } catch (error) {
    console.error('stories/list error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// Publica una foto ya subida con /api/profiles/photo como historia (dura 24 h)
export async function POST(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`story-post:${auth.userId}`, 20, 10 * 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Estás publicando muy seguido, esperá unos minutos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { photoUrl, caption } = (body ?? {}) as { photoUrl?: unknown; caption?: unknown }
  if (typeof photoUrl !== 'string' || !isOwnPhotoUrl(photoUrl, auth.userId)) {
    return Response.json({ error: 'Foto inválida' }, { status: 400 })
  }
  const text = typeof caption === 'string' ? caption.trim() : ''
  if (text.length > CAPTION_MAX) {
    return Response.json({ error: `El texto admite hasta ${CAPTION_MAX} caracteres` }, { status: 400 })
  }

  try {
    return Response.json({ story: await createStory(auth.userId, photoUrl, text) })
  } catch (error) {
    console.error('stories/create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
