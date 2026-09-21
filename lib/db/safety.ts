// Seguridad: bloquear, reportar, deshacer match
import { callFn, iso } from '@/lib/db/core'

export type BlockedUser = { id: string; name: string; photo: string; blockedAt: string }

export const isBlockedBetween = async (a: string, b: string) => {
  const [r] = await callFn<{ is_blocked: boolean }>('blocked_between', { p_a: a, p_b: b })
  return r?.is_blocked === true
}

// false = el usuario a bloquear no existe
export const blockUser = async (userId: string, targetId: string) => {
  const [r] = await callFn<{ ok: boolean }>('block_user', { p_blocker: userId, p_blocked: targetId })
  return r?.ok === true
}

export const unblockUser = async (userId: string, targetId: string) => {
  const [r] = await callFn<{ ok: boolean }>('unblock_user', { p_blocker: userId, p_blocked: targetId })
  return r?.ok === true
}

export const listBlocked = async (userId: string): Promise<BlockedUser[]> => {
  const rows = await callFn<{
    blocked_user: string
    blocked_name: string
    blocked_photo: string | null
    blocked_at: string | Date
  }>('list_blocked', { p_user: userId })
  return rows.map((r) => ({
    id: r.blocked_user,
    name: r.blocked_name,
    photo: r.blocked_photo ?? '',
    blockedAt: iso(r.blocked_at),
  }))
}

export const unmatch = async (userId: string, conversationId: string) => {
  const [r] = await callFn<{ ok: boolean }>('unmatch', { p_user: userId, p_conversation: conversationId })
  return r?.ok === true
}

export type ReportInput = {
  reportedUserId: string
  type: 'profile' | 'photo' | 'comment' | 'story' | 'chat'
  targetId: string | null
  reason: 'inappropriate' | 'harassment' | 'spam' | 'fake' | 'other'
  details: string
  context: unknown
}

// null = el reportado no existe
export const createReport = async (reporterId: string, input: ReportInput) => {
  const [r] = await callFn<{ new_report_id: string }>('create_report', {
    p_reporter: reporterId,
    p_reported: input.reportedUserId,
    p_type: input.type,
    p_target: input.targetId,
    p_reason: input.reason,
    p_details: input.details,
    p_context: input.context,
  })
  return r?.new_report_id ?? null
}
