import { getAuth, unauthorized } from '@/lib/api-auth'
import { createPhoto, getAuthor, isBlockedBetween, listPhotos } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isOwnPhotoUrl } from '@/lib/storage'
import { UUID_RE } from '@/lib/validators'

const CAPTION_MAX = 300

// Feed (mas nuevas primero). ?before=<iso> pagina; ?author=<userId> arma la grilla de un invitado.
export async function GET(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const params = new URL(req.url).searchParams
  const beforeRaw = params.get('before')
  const before = beforeRaw && !Number.isNaN(new Date(beforeRaw).getTime()) ? new Date(beforeRaw).toISOString() : undefined
  const authorRaw = params.get('author')
  if (authorRaw && !UUID_RE.test(authorRaw)) {
    return Response.json({ error: 'Autor inválido' }, { status: 400 })
  }
  const limit = Math.min(Math.max(Number(params.get('limit')) || 12, 1), 60)

  try {
    if (authorRaw && (await isBlockedBetween(auth.userId, authorRaw))) {
      return Response.json({ error: 'Invitado no encontrado' }, { status: 404 })
    }
    const photos = await listPhotos(auth.userId, { before, author: authorRaw ?? undefined, limit })
    const author = authorRaw ? await getAuthor(authorRaw) : undefined
    if (authorRaw && !author) return Response.json({ error: 'Invitado no encontrado' }, { status: 404 })
    return Response.json({ photos, author })
  } catch (error) {
    console.error('photos/list error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// Publica una foto ya subida con /api/profiles/photo
export async function POST(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`photo-post:${auth.userId}`, 20, 10 * 60_000)
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
    return Response.json({ error: `El epígrafe admite hasta ${CAPTION_MAX} caracteres` }, { status: 400 })
  }

  try {
    const photo = await createPhoto(auth.userId, photoUrl, text)
    return Response.json({ photo })
  } catch (error) {
    console.error('photos/create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
