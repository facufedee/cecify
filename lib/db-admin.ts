// Acceso a datos del panel de administracion. Cada funcion SQL vuelve a comprobar que `actorId`
// sea admin o superadmin: si no lo es, no devuelve nada ni cambia nada.
import { callFn, iso } from '@/lib/db'
import type { Side } from '@/lib/profile-schema'
import type { Role } from '@/lib/roles'

type Ts = string | Date

// ---- Metricas ----

export type AdminStats = {
  guestsTotal: number
  guestsJoined: number
  profilesTotal: number
  wantsMatch: number
  onlyWall: number
  sides: { bride: number; groom: number; both: number; unset: number }
  matches: number
  messages: number
  photos: number
  comments: number
  storiesActive: number
  reportsOpen: number
  blocks: number
}

export const adminStats = async (actorId: string): Promise<AdminStats | null> => {
  const [r] = await callFn<Record<string, number>>('admin_stats', { p_actor: actorId })
  if (!r) return null
  return {
    guestsTotal: r.guests_total,
    guestsJoined: r.guests_joined,
    profilesTotal: r.profiles_total,
    wantsMatch: r.wants_match,
    onlyWall: r.only_wall,
    sides: { bride: r.side_bride, groom: r.side_groom, both: r.side_both, unset: r.side_unset },
    matches: r.matches_total,
    messages: r.messages_total,
    photos: r.photos_total,
    comments: r.comments_total,
    storiesActive: r.stories_active,
    reportsOpen: r.reports_open,
    blocks: r.blocks_total,
  }
}

// ---- Invitados ----

export type AdminGuest = {
  id: string
  name: string
  email: string
  code: string
  side: Side | null
  createdAt: string
  userId: string | null // null = todavia no inicio sesion
  role: Role | null
  hasProfile: boolean
}

export const adminListGuests = async (
  actorId: string,
  opts: { search?: string; limit?: number; offset?: number } = {}
): Promise<{ guests: AdminGuest[]; total: number }> => {
  const rows = await callFn<{
    guest_id: string
    guest_name: string
    guest_email: string
    guest_code: string
    guest_side: Side | null
    created_at: Ts
    user_id: string | null
    user_role: Role | null
    has_profile: boolean
    total_count: number | string
  }>('admin_list_guests', {
    p_actor: actorId,
    p_search: opts.search ?? null,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  })
  return {
    total: rows.length ? Number(rows[0].total_count) : 0,
    guests: rows.map((r) => ({
      id: r.guest_id,
      name: r.guest_name,
      email: r.guest_email,
      code: r.guest_code,
      side: r.guest_side,
      createdAt: iso(r.created_at),
      userId: r.user_id,
      role: r.user_role,
      hasProfile: r.has_profile,
    })),
  }
}

// side: undefined = no cambiar, null = quitar. null = sin permiso.
export const adminUpsertGuest = async (
  actorId: string,
  input: { name: string; email: string; code: string; side?: Side | null; replaceCode?: boolean }
) => {
  const [r] = await callFn<{ out_id: string; out_code: string; out_created: boolean }>('admin_upsert_guest', {
    p_actor: actorId,
    p_name: input.name,
    p_email: input.email,
    p_code: input.code,
    p_side: input.side === undefined ? null : (input.side ?? ''),
    p_replace_code: input.replaceCode ?? false,
  })
  return r ? { id: r.out_id, code: r.out_code, created: r.out_created } : null
}

// Edita por id; undefined = no cambiar (side null = quitar). null = no existe o sin permiso.
export const adminUpdateGuest = async (
  actorId: string,
  guestId: string,
  changes: { name?: string; side?: Side | null; code?: string }
) => {
  const [r] = await callFn<{ out_id: string; out_code: string }>('admin_update_guest', {
    p_actor: actorId,
    p_guest: guestId,
    p_name: changes.name ?? null,
    p_side: changes.side === undefined ? null : (changes.side ?? ''),
    p_code: changes.code ?? null,
  })
  return r ? { id: r.out_id, code: r.out_code } : null
}

export type DeleteGuestStatus = 'ok' | 'forbidden' | 'not_found' | 'has_role'

export const adminDeleteGuest = async (actorId: string, guestId: string): Promise<DeleteGuestStatus> => {
  const [r] = await callFn<{ out_status: DeleteGuestStatus }>('admin_delete_guest', {
    p_actor: actorId,
    p_guest: guestId,
  })
  return r?.out_status ?? 'forbidden'
}

// ---- Reportes ----

export type ReportStatus = 'open' | 'reviewed' | 'dismissed'
export type ReportType = 'profile' | 'photo' | 'comment' | 'story' | 'chat'

export type AdminReport = {
  id: string
  type: ReportType
  reason: string
  details: string | null
  status: ReportStatus
  createdAt: string
  reviewedAt: string | null
  targetId: string | null
  context: Record<string, unknown> | null
  reporter: { id: string; name: string }
  reported: { id: string; name: string; photo: string; role: Role; reportsTotal: number; reportsOpen: number }
}

export const adminListReports = async (
  actorId: string,
  opts: { status?: ReportStatus; before?: string; limit?: number } = {}
): Promise<AdminReport[]> => {
  const rows = await callFn<{
    report_id: string
    report_type: ReportType
    reason: string
    details: string | null
    status: ReportStatus
    created_at: Ts
    reviewed_at: Ts | null
    target_id: string | null
    context: Record<string, unknown> | null
    reporter_id: string
    reporter_name: string
    reported_id: string
    reported_name: string
    reported_photo: string | null
    reported_role: Role
    reports_against: number
    open_against: number
  }>('admin_list_reports', {
    p_actor: actorId,
    p_status: opts.status ?? null,
    p_limit: opts.limit ?? 30,
    p_before: opts.before ?? null,
  })
  return rows.map((r) => ({
    id: r.report_id,
    type: r.report_type,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: iso(r.created_at),
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
    targetId: r.target_id,
    context: r.context,
    reporter: { id: r.reporter_id, name: r.reporter_name },
    reported: {
      id: r.reported_id,
      name: r.reported_name,
      photo: r.reported_photo ?? '',
      role: r.reported_role,
      reportsTotal: r.reports_against,
      reportsOpen: r.open_against,
    },
  }))
}

export const adminSetReportStatus = async (actorId: string, reportId: string, status: string) => {
  const [r] = await callFn<{ out_ok: boolean }>('admin_set_report_status', {
    p_actor: actorId,
    p_report: reportId,
    p_status: status,
  })
  return r?.out_ok === true
}

// ---- Contenido ----

export type AdminPhoto = {
  id: string
  authorId: string
  authorName: string
  photoUrl: string
  caption: string | null
  likesCount: number
  commentsCount: number
  createdAt: string
}

export const adminListPhotos = async (
  actorId: string,
  opts: { before?: string; limit?: number } = {}
): Promise<AdminPhoto[]> => {
  const rows = await callFn<{
    photo_id: string
    author_id: string
    author_name: string
    photo_url: string
    caption: string | null
    likes_count: number
    comments_count: number
    created_at: Ts
  }>('admin_list_photos', { p_actor: actorId, p_before: opts.before ?? null, p_limit: opts.limit ?? 24 })
  return rows.map((r) => ({
    id: r.photo_id,
    authorId: r.author_id,
    authorName: r.author_name,
    photoUrl: r.photo_url,
    caption: r.caption,
    likesCount: r.likes_count,
    commentsCount: r.comments_count,
    createdAt: iso(r.created_at),
  }))
}

export type AdminComment = { id: string; authorId: string; authorName: string; body: string; createdAt: string }

export const adminListComments = async (actorId: string, photoId: string): Promise<AdminComment[]> => {
  const rows = await callFn<{
    comment_id: string
    author_id: string
    author_name: string
    body: string
    created_at: Ts
  }>('admin_list_comments', { p_actor: actorId, p_photo: photoId })
  return rows.map((r) => ({
    id: r.comment_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: iso(r.created_at),
  }))
}

// Devuelve la url de la foto borrada (el archivo queda en el storage) o null si no existia
export const adminDeletePhoto = async (actorId: string, photoId: string) => {
  const [r] = await callFn<{ out_url: string }>('admin_delete_photo', { p_actor: actorId, p_photo: photoId })
  return r?.out_url ?? null
}

export const adminDeleteComment = async (actorId: string, commentId: string) => {
  const rows = await callFn<{ out_id: string }>('admin_delete_comment', { p_actor: actorId, p_comment: commentId })
  return rows.length > 0
}

export type AdminStory = {
  id: string
  authorId: string
  authorName: string
  photoUrl: string
  caption: string | null
  createdAt: string
  expiresAt: string
  viewsCount: number
}

export const adminListStories = async (actorId: string): Promise<AdminStory[]> => {
  const rows = await callFn<{
    story_id: string
    author_id: string
    author_name: string
    photo_url: string
    caption: string | null
    created_at: Ts
    expires_at: Ts
    views_count: number
  }>('admin_list_stories', { p_actor: actorId })
  return rows.map((r) => ({
    id: r.story_id,
    authorId: r.author_id,
    authorName: r.author_name,
    photoUrl: r.photo_url,
    caption: r.caption,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    viewsCount: r.views_count,
  }))
}

export const adminDeleteStory = async (actorId: string, storyId: string) => {
  const [r] = await callFn<{ out_url: string }>('admin_delete_story', { p_actor: actorId, p_story: storyId })
  return r?.out_url ?? null
}

// ---- Registro de acciones ----

export type AdminAction = {
  id: string
  actorName: string
  action: string
  targetType: string
  targetId: string | null
  details: Record<string, unknown> | null
  createdAt: string
}

export const adminRecentActions = async (actorId: string, limit = 30): Promise<AdminAction[]> => {
  const rows = await callFn<{
    action_id: string
    actor_name: string
    action: string
    target_type: string
    target_id: string | null
    details: Record<string, unknown> | null
    created_at: Ts
  }>('admin_recent_actions', { p_actor: actorId, p_limit: limit })
  return rows.map((r) => ({
    id: r.action_id,
    actorName: r.actor_name,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    createdAt: iso(r.created_at),
  }))
}
