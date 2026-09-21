// SOLO DESARROLLO (LOCAL_DB=1): los invitados demo contestan solos para poder probar el chat
// sin dos personas reales. Nunca se ejecuta contra Supabase.
import { isDemoUser, markRead, sendMessage, type ChatMessage } from '@/lib/db'
import { emitTo } from '@/lib/realtime'

const REPLIES = [
  '¡Hola! Qué bueno que hicimos match 😊',
  'Jaja, me encantó tu perfil. ¿Vas a bailar mucho?',
  '¿Ya probaste la mesa dulce? Dicen que es lo mejor.',
  'Me anoto para el primer baile juntos 💃',
  '¿De qué lado de la familia sos?',
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const maybeDemoReply = async (sent: ChatMessage & { toUserId: string }, senderName: string) => {
  if (process.env.LOCAL_DB !== '1' || process.env.NODE_ENV === 'production') return
  if (!(await isDemoUser(sent.toUserId))) return

  // Primero "lee" el mensaje (aparece el "Visto"), despues contesta
  await sleep(700)
  const { marked, readUpTo } = await markRead(sent.toUserId, sent.conversationId)
  if (marked > 0 && readUpTo) {
    await emitTo(sent.fromUserId, 'messages:read', { conversationId: sent.conversationId, readUpTo })
  }

  await sleep(1300)
  const content = REPLIES[Math.floor(Math.random() * REPLIES.length)]
  const reply = await sendMessage(sent.toUserId, sent.conversationId, content)
  if (!reply) return

  await emitTo(sent.fromUserId, 'message:new', {
    message: reply,
    fromName: senderName,
    preview: content,
  })
}
