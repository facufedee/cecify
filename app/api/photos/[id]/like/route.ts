import { after } from 'next/server'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { getAuthor, togglePhotoLike } from '@/lib/db'
import { emitTo } from '@/lib/realtime'
import { rateLimit } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Alterna el "me gusta" del usuario en la foto y devuelve el estado real
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Foto inválida' }, { status: 400 })

  const limit = rateLimit(`photo-like:${auth.userId}`, 60, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Vas muy rápido, esperá unos segundos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  try {
    const result = await togglePhotoLike(auth.userId, id)
    if (!result) return Response.json({ error: 'Foto no encontrada' }, { status: 404 })

    if (result.liked && result.ownerId !== auth.userId) {
      after(async () => {
        const me = await getAuthor(auth.userId)
        await emitTo(result.ownerId, 'photo:liked', { photoId: id, name: me?.name ?? 'Alguien' })
      })
    }

    return Response.json({ liked: result.liked, likesCount: result.likesCount })
  } catch (error) {
    console.error('photos/like error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
