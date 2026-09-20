// SOLO DESARROLLO (LOCAL_DB=1): los invitados demo contestan solos para poder probar el chat
// sin dos personas reales. Nunca se ejecuta contra Supabase.
import { isDemoUser, sendMessage, type ChatMessage } from '@/lib/db'
import { emitTo } from '@/lib/realtime'

const REPLIES = [
  '¡Hola! Qué bueno que hicimos match 😊',
  'Jaja, me encantó tu perfil. ¿Vas a bailar mucho?',
  '¿Ya probaste la mesa dulce? Dicen que es lo mejor.',
  'Me anoto para el primer baile juntos 💃',
  '¿De qué lado de la familia sos?',
]

export const maybeDemoReply = async (sent: ChatMessage & { toUserId: string }, senderName: string) => {
  if (process.env.LOCAL_DB !== '1' || process.env.NODE_ENV === 'production') return
  if (!(await isDemoUser(sent.toUserId))) return

  await new Promise((r) => setTimeout(r, 1500))
  const content = REPLIES[Math.floor(Math.random() * REPLIES.length)]
  const reply = await sendMessage(sent.toUserId, sent.conversationId, content)
  if (!reply) return

  await emitTo(sent.fromUserId, 'message:new', {
    message: reply,
    fromName: senderName,
    preview: content,
  })
}
