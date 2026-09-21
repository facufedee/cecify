// Matches y chat
import { callFn, iso } from '@/lib/db/core'

export type Conversation = {
  id: string
  matchId: string
  matchedAt: string
  other: {
    userId: string
    profileId: string
    name: string
    age: number
    photo: string
    contact: { instagram?: string; whatsapp?: string }
  }
  lastMessage: { content: string; fromMe: boolean; at: string } | null
  unread: number
}

type ConversationRow = {
  conversation_id: string
  match_id: string
  matched_at: string | Date
  other_user_id: string
  other_profile_id: string
  other_name: string
  other_age: number | null
  other_photo: string | null
  other_contact: Conversation['other']['contact'] | null
  last_content: string | null
  last_from: string | null
  last_at: string | Date | null
  unread_count: number
}

export const listConversations = async (userId: string): Promise<Conversation[]> => {
  const rows = await callFn<ConversationRow>('list_conversations', { p_user: userId })
  return rows.map((r) => ({
    id: r.conversation_id,
    matchId: r.match_id,
    matchedAt: iso(r.matched_at),
    other: {
      userId: r.other_user_id,
      profileId: r.other_profile_id,
      name: r.other_name,
      age: r.other_age ?? 0,
      photo: r.other_photo ?? '',
      contact: r.other_contact ?? {},
    },
    lastMessage:
      r.last_content !== null && r.last_at
        ? { content: r.last_content, fromMe: r.last_from === userId, at: iso(r.last_at) }
        : null,
    unread: r.unread_count,
  }))
}

export type ChatMessage = {
  id: string
  conversationId: string
  fromUserId: string
  content: string
  createdAt: string
  isRead?: boolean
}

type MessageRow = {
  msg_id: string
  msg_from: string
  msg_content: string
  msg_is_read: boolean
  msg_created_at: string | Date
}

export const getMessages = async (
  userId: string,
  conversationId: string,
  opts: { before?: string; after?: string; limit?: number } = {}
): Promise<ChatMessage[]> => {
  const rows = await callFn<MessageRow>('get_messages', {
    p_user: userId,
    p_conversation: conversationId,
    p_before: opts.before ?? null,
    p_after: opts.after ?? null,
    p_limit: opts.limit ?? 50,
  })
  return rows.map((r) => ({
    id: r.msg_id,
    conversationId,
    fromUserId: r.msg_from,
    content: r.msg_content,
    createdAt: iso(r.msg_created_at),
    isRead: r.msg_is_read,
  }))
}

type SentRow = {
  msg_id: string
  msg_conversation_id: string
  msg_from: string
  msg_to: string
  msg_content: string
  msg_created_at: string | Date
}

// null = el usuario no participa de esa conversacion
export const sendMessage = async (
  userId: string,
  conversationId: string,
  content: string
): Promise<(ChatMessage & { toUserId: string }) | null> => {
  const [r] = await callFn<SentRow>('send_message', {
    p_from: userId,
    p_conversation: conversationId,
    p_content: content,
  })
  if (!r) return null
  return {
    id: r.msg_id,
    conversationId: r.msg_conversation_id,
    fromUserId: r.msg_from,
    toUserId: r.msg_to,
    content: r.msg_content,
    createdAt: iso(r.msg_created_at),
  }
}

// Marca como leido lo que le llego al usuario. `readUpTo` = fecha del ultimo mensaje marcado (null si no habia nada nuevo).
export const markRead = async (userId: string, conversationId: string) => {
  const [r] = await callFn<{ marked: number; read_up_to: string | Date | null }>('mark_read', {
    p_user: userId,
    p_conversation: conversationId,
  })
  return { marked: r?.marked ?? 0, readUpTo: r?.read_up_to ? iso(r.read_up_to) : null }
}

// Hasta cuando leyo la otra persona lo que el usuario le envio (null = nada leido todavia)
export const getReadState = async (userId: string, conversationId: string): Promise<string | null> => {
  const [r] = await callFn<{ out_read_up_to: string | Date | null }>('chat_read_state', {
    p_user: userId,
    p_conversation: conversationId,
  })
  return r?.out_read_up_to ? iso(r.out_read_up_to) : null
}

export const unreadTotal = async (userId: string) => {
  const [r] = await callFn<{ out_count: number }>('unread_total', { p_user: userId })
  return r?.out_count ?? 0
}
