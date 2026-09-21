import { after } from 'next/server'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { getUserContext, sendMessage } from '@/lib/db'
import { maybeDemoReply } from '@/lib/dev-demo'
import { emitTo } from '@/lib/realtime'
import { sendPush } from '@/lib/push-server'
import { rateLimit } from '@/lib/rate-limit'
import { UUID_RE } from '@/lib/validators'

const MAX_LENGTH = 1000

export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`message:${auth.userId}`, 100, 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Estás escribiendo muy rápido, esperá unos segundos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { conversationId, content } = (body ?? {}) as { conversationId?: unknown; content?: unknown }
  if (typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) {
    return Response.json({ error: 'Conversación inválida' }, { status: 400 })
  }
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return Response.json({ error: 'El mensaje está vacío' }, { status: 400 })
  if (text.length > MAX_LENGTH) {
    return Response.json({ error: `Máximo ${MAX_LENGTH} caracteres` }, { status: 400 })
  }

  try {
    const message = await sendMessage(auth.userId, conversationId, text)
    if (!message) return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })

    // Despues de responder: aviso en tiempo real al destinatario (y respuesta demo en desarrollo)
    after(async () => {
      const me = (await getUserContext(auth.userId))?.profile
      const fromName = me?.name ?? 'Alguien'
      await emitTo(message.toUserId, 'message:new', {
        message,
        fromName,
        preview: text.slice(0, 80),
      })
      // Para quien no tiene la app abierta (el service worker no lo muestra si la esta mirando)
      await sendPush(message.toUserId, {
        title: fromName,
        body: text,
        url: `/matches/${conversationId}`,
        tag: `chat-${conversationId}`,
      })
      await maybeDemoReply(message, fromName)
    })

    return Response.json({ message })
  } catch (error) {
    console.error('messages/send error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
