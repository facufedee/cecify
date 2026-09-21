// Muro de fotos y comentarios
import { callFn, iso } from '@/lib/db/core'
import { getAuthor } from '@/lib/db/profiles'

export type WallPhoto = {
  id: string
  authorId: string
  authorName: string
  authorPhoto: string
  photoUrl: string
  caption: string | null
  likesCount: number
  commentsCount: number
  likedByMe: boolean
  createdAt: string
}

type WallPhotoRow = {
  photo_id: string
  author_id: string
  author_name: string
  author_photo: string | null
  photo_url: string
  caption: string | null
  likes_count: number
  comments_count: number
  liked_by_me: boolean
  created_at: string | Date
}

const toWallPhoto = (r: WallPhotoRow): WallPhoto => ({
  id: r.photo_id,
  authorId: r.author_id,
  authorName: r.author_name,
  authorPhoto: r.author_photo ?? '',
  photoUrl: r.photo_url,
  caption: r.caption,
  likesCount: r.likes_count,
  commentsCount: r.comments_count,
  likedByMe: r.liked_by_me,
  createdAt: iso(r.created_at),
})

export const listPhotos = async (
  userId: string,
  opts: { before?: string; author?: string; photo?: string; limit?: number } = {}
): Promise<WallPhoto[]> => {
  const rows = await callFn<WallPhotoRow>('list_photos', {
    p_user: userId,
    p_before: opts.before ?? null,
    p_author: opts.author ?? null,
    p_limit: opts.limit ?? 12,
    p_photo: opts.photo ?? null,
  })
  return rows.map(toWallPhoto)
}

export const createPhoto = async (userId: string, url: string, caption: string) => {
  const [r] = await callFn<{ new_photo_id: string }>('create_photo', {
    p_user: userId,
    p_url: url,
    p_caption: caption,
  })
  return (await listPhotos(userId, { photo: r.new_photo_id }))[0]
}

// Devuelve la url borrada (para limpiar el archivo) o null si no existe / no es del usuario
export const deletePhoto = async (userId: string, photoId: string) => {
  const [r] = await callFn<{ deleted_id: string; deleted_url: string }>('delete_photo', {
    p_user: userId,
    p_photo: photoId,
  })
  return r ? r.deleted_url : null
}

export const togglePhotoLike = async (userId: string, photoId: string) => {
  const [r] = await callFn<{ liked: boolean; total: number; photo_owner: string }>('toggle_photo_like', {
    p_user: userId,
    p_photo: photoId,
  })
  return r ? { liked: r.liked, likesCount: r.total, ownerId: r.photo_owner } : null
}

export type WallComment = {
  id: string
  authorId: string
  authorName: string
  authorPhoto: string
  body: string
  createdAt: string
}

type CommentRow = {
  comment_id: string
  author_id: string
  author_name: string
  author_photo: string | null
  body: string
  created_at: string | Date
}

export const listComments = async (viewerId: string, photoId: string): Promise<WallComment[]> => {
  const rows = await callFn<CommentRow>('list_comments', { p_viewer: viewerId, p_photo: photoId, p_limit: 100 })
  return rows.map((r) => ({
    id: r.comment_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorPhoto: r.author_photo ?? '',
    body: r.body,
    createdAt: iso(r.created_at),
  }))
}

// null = la foto no existe o hay un bloqueo entre las dos personas. `photoOwnerId` es a quien hay que avisar.
export const addComment = async (
  userId: string,
  photoId: string,
  content: string
): Promise<(WallComment & { photoOwnerId: string }) | null> => {
  const [r] = await callFn<{ comment_id: string; created_at: string | Date; photo_owner: string }>('add_comment', {
    p_user: userId,
    p_photo: photoId,
    p_content: content,
  })
  if (!r) return null
  const author = await getAuthor(userId)
  return {
    id: r.comment_id,
    authorId: userId,
    authorName: author?.name ?? 'Invitado',
    authorPhoto: author?.photo ?? '',
    body: content.trim(),
    createdAt: iso(r.created_at),
    photoOwnerId: r.photo_owner,
  }
}
