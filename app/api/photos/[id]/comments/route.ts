import { getAuth, unauthorized } from '@/lib/api-auth'
import { addComment, listComments } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMMENT_MAX = 300

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Foto inválida' }, { status: 400 })

  try {
    return Response.json({ comments: await listComments(id) })
  } catch (error) {
    console.error('photos/comments list error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
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
    return Response.json({ comment })
  } catch (error) {
    console.error('photos/comments create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
