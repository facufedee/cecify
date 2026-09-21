import { after } from 'next/server'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { addStoryReply, getAuthor, listStoryReplies } from '@/lib/db'
import { sendPush } from '@/lib/push-server'
import { emitTo } from '@/lib/realtime'
import { rateLimit } from '@/lib/rate-limit'
import { UUID_RE } from '@/lib/validators'

const REPLY_MAX = 150

// Respuestas a MI historia (solo las ve quien la publico; a otra persona le devuelve una lista vacia)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Historia inválida' }, { status: 400 })

  try {
    return Response.json({ replies: await listStoryReplies(auth.userId, id) })
  } catch (error) {
    console.error('stories/replies list error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// Responde a la historia de otra persona: le llega a ella sola (aviso en la app y notificacion)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Historia inválida' }, { status: 400 })

  const limit = rateLimit(`story-reply:${auth.userId}`, 30, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Estás respondiendo muy rápido, esperá unos segundos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  const raw = ((await req.json().catch(() => null)) as { content?: unknown } | null)?.content
  const content = typeof raw === 'string' ? raw.trim() : ''
  if (!content) return Response.json({ error: 'La respuesta está vacía' }, { status: 400 })
  if (content.length > REPLY_MAX) {
    return Response.json({ error: `Máximo ${REPLY_MAX} caracteres` }, { status: 400 })
  }

  try {
    const reply = await addStoryReply(auth.userId, id, content)
    if (!reply) return Response.json({ error: 'No se pudo responder: la historia ya no está disponible' }, { status: 404 })

    after(async () => {
      const name = (await getAuthor(auth.userId))?.name ?? 'Alguien'
      await emitTo(reply.ownerId, 'story:replied', { storyId: id, name, preview: content.slice(0, 80) })
      await sendPush(reply.ownerId, {
        title: name,
        body: `Respondió a tu historia: ${content}`,
        url: '/photos',
        tag: `story-reply-${id}-${auth.userId}`,
      })
    })

    return Response.json({ ok: true })
  } catch (error) {
    console.error('stories/replies create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
