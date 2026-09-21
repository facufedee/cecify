// Historias (24 h) y respuestas privadas
import { callFn, iso } from '@/lib/db/core'

export type StoryAuthor = {
  authorId: string
  name: string
  photo: string
  count: number
  latestAt: string
  hasUnseen: boolean
}

export type Story = {
  id: string
  photoUrl: string
  caption: string | null
  createdAt: string
  expiresAt: string
  seenByMe: boolean
  viewsCount: number | null // solo lo ve el autor
}

export type StoryViewerInfo = { id: string; name: string; photo: string; viewedAt: string }

export const listStoryRings = async (userId: string): Promise<StoryAuthor[]> => {
  const rows = await callFn<{
    author_id: string
    author_name: string
    author_photo: string | null
    stories_count: number
    latest_at: string | Date
    has_unseen: boolean
  }>('list_story_rings', { p_user: userId })
  return rows.map((r) => ({
    authorId: r.author_id,
    name: r.author_name,
    photo: r.author_photo ?? '',
    count: r.stories_count,
    latestAt: iso(r.latest_at),
    hasUnseen: r.has_unseen,
  }))
}

export const listStories = async (userId: string, authorId: string): Promise<Story[]> => {
  const rows = await callFn<{
    story_id: string
    photo_url: string
    caption: string | null
    created_at: string | Date
    expires_at: string | Date
    seen_by_me: boolean
    views_count: number | null
  }>('list_stories', { p_user: userId, p_author: authorId })
  return rows.map((r) => ({
    id: r.story_id,
    photoUrl: r.photo_url,
    caption: r.caption,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    seenByMe: r.seen_by_me,
    viewsCount: r.views_count,
  }))
}

export const createStory = async (userId: string, url: string, caption: string) => {
  const [r] = await callFn<{ new_story_id: string }>('create_story', {
    p_user: userId,
    p_url: url,
    p_caption: caption,
  })
  return (await listStories(userId, userId)).find((s) => s.id === r.new_story_id)!
}

// true si existia y era del usuario
export const deleteStory = async (userId: string, storyId: string) => {
  const rows = await callFn<{ deleted_id: string }>('delete_story', { p_user: userId, p_story: storyId })
  return rows.length > 0
}

export const markStoryViewed = async (userId: string, storyId: string) => {
  const [r] = await callFn<{ marked: boolean }>('mark_story_viewed', { p_user: userId, p_story: storyId })
  return r?.marked ?? false
}

export const listStoryViewers = async (userId: string, storyId: string): Promise<StoryViewerInfo[]> => {
  const rows = await callFn<{
    viewer_id: string
    viewer_name: string
    viewer_photo: string | null
    viewed_at: string | Date
  }>('list_story_viewers', { p_user: userId, p_story: storyId })
  return rows.map((r) => ({
    id: r.viewer_id,
    name: r.viewer_name,
    photo: r.viewer_photo ?? '',
    viewedAt: iso(r.viewed_at),
  }))
}

// ---- Respuestas a historias (privadas: solo las ve quien publico la historia) ----

export type StoryReply = { id: string; fromId: string; fromName: string; fromPhoto: string; content: string; createdAt: string }

// null = la historia no existe / ya vencio, es propia, o hay un bloqueo. `ownerId` es a quien hay que avisar.
export const addStoryReply = async (userId: string, storyId: string, content: string) => {
  const [r] = await callFn<{ out_id: string; out_owner: string }>('add_story_reply', {
    p_user: userId,
    p_story: storyId,
    p_content: content,
  })
  return r ? { id: r.out_id, ownerId: r.out_owner } : null
}

// Vacio si `userId` no es el autor de la historia
export const listStoryReplies = async (userId: string, storyId: string): Promise<StoryReply[]> => {
  const rows = await callFn<{
    reply_id: string
    from_id: string
    from_name: string
    from_photo: string | null
    content: string
    created_at: string | Date
  }>('list_story_replies', { p_user: userId, p_story: storyId })
  return rows.map((r) => ({
    id: r.reply_id,
    fromId: r.from_id,
    fromName: r.from_name,
    fromPhoto: r.from_photo ?? '',
    content: r.content,
    createdAt: iso(r.created_at),
  }))
}
