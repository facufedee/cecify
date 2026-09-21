import { after } from 'next/server'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { addComment, listComments } from '@/lib/db'
import { sendPush } from '@/lib/push-server'
import { emitTo } from '@/lib/realtime'
import { rateLimit } from '@/lib/rate-limit'
import { UUID_RE } from '@/lib/validators'

const COMMENT_MAX = 300

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Foto inválida' }, { status: 400 })

  try {
    return Response.json({ comments: await listComments(auth.userId, id) })
  } catch (error) {
    console.error('photos/comments list error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Foto inválida' }, { status: 400 })

  const limit = rateLimit(`photo-comment:${auth.userId}`, 20, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Estás comentando muy rápido, esperá unos segundos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const content = typeof (body as { content?: unknown })?.content === 'string' ? (body as { content: string }).content.trim() : ''
  if (!content) return Response.json({ error: 'El comentario está vacío' }, { status: 400 })
  if (content.length > COMMENT_MAX) {
    return Response.json({ error: `Máximo ${COMMENT_MAX} caracteres` }, { status: 400 })
  }

  try {
    const comment = await addComment(auth.userId, id, content)
    if (!comment) return Response.json({ error: 'Foto no encontrada' }, { status: 404 })

    // Aviso al dueno de la foto (no si se comenta a si mismo)
    if (comment.photoOwnerId !== auth.userId) {
      after(async () => {
        await emitTo(comment.photoOwnerId, 'photo:commented', {
          photoId: id,
          name: comment.authorName,
          preview: content.slice(0, 80),
        })
        await sendPush(comment.photoOwnerId, {
          title: comment.authorName,
          body: `Comentó tu foto: ${content}`,
          url: '/photos',
          tag: `comment-${id}`,
        })
      })
    }

    const { photoOwnerId: _owner, ...publicComment } = comment
    void _owner
    return Response.json({ comment: publicComment })
  } catch (error) {
    console.error('photos/comments create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
