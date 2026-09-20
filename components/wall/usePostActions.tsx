'use client'

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import ActionSheet from '@/components/wall/ActionSheet'
import { useSafety } from '@/components/safety/useSafety'
import CommentsSheet from '@/components/wall/CommentsSheet'
import { authFetch, getSessionUserId } from '@/lib/client-auth'
import type { WallPhoto } from '@/lib/db'

// Acciones compartidas por el feed, la grilla y el visor: me gusta, comentarios, menu y borrado.
export function usePostActions(photos: WallPhoto[], setPhotos: Dispatch<SetStateAction<WallPhoto[]>>) {
  const router = useRouter()
  const myId = getSessionUserId()
  const [commentsFor, setCommentsFor] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<WallPhoto | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<WallPhoto | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Al bloquear a alguien, sus fotos salen de la lista
  const safety = useSafety({
    onBlocked: (t) => setPhotos((prev) => prev.filter((p) => p.authorId !== t.userId)),
  })

  const patch = useCallback(
    (id: string, changes: Partial<WallPhoto>) =>
      setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p))),
    [setPhotos]
  )

  const like = useCallback(
    async (photo: WallPhoto) => {
      const liked = !photo.likedByMe
      patch(photo.id, { likedByMe: liked, likesCount: Math.max(0, photo.likesCount + (liked ? 1 : -1)) })
      try {
        const res = await authFetch(`/api/photos/${photo.id}/like`, { method: 'POST' })
        if (!res.ok) throw new Error()
        const data = await res.json()
        patch(photo.id, { likedByMe: data.liked, likesCount: data.likesCount })
      } catch {
        patch(photo.id, { likedByMe: photo.likedByMe, likesCount: photo.likesCount })
      }
    },
    [patch]
  )

  const remove = useCallback(
    async (photo: WallPhoto) => {
      setConfirmDelete(null)
      setMenuFor(null)
      try {
        const res = await authFetch(`/api/photos/${photo.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
      } catch {
        setError('No se pudo eliminar la publicación')
        setTimeout(() => setError(null), 3500)
      }
    },
    [setPhotos]
  )

  const openAuthor = useCallback(
    (authorId: string) => router.push(authorId === myId ? '/profile' : `/photos/u/${authorId}`),
    [router, myId]
  )

  const commentsPhoto = commentsFor ? photos.find((p) => p.id === commentsFor) : undefined

  const overlays = (
    <>
      <AnimatePresence>
        {commentsPhoto && (
          <CommentsSheet
            key="comments"
            photo={commentsPhoto}
            myId={myId}
            onClose={() => setCommentsFor(null)}
            onReport={(c) =>
              safety.openReport({
                name: c.authorName,
                userId: c.authorId,
                type: 'comment',
                targetId: c.id,
                photoId: commentsPhoto.id,
              })
            }
            onAdded={(id) =>
              setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, commentsCount: p.commentsCount + 1 } : p)))
            }
          />
        )}
        {menuFor && !confirmDelete && (
          <ActionSheet
            key="menu"
            onClose={() => setMenuFor(null)}
            actions={
              menuFor.authorId === myId
                ? [{ label: 'Eliminar', destructive: true, onClick: () => setConfirmDelete(menuFor) }]
                : [
                    {
                      label: 'Reportar',
                      destructive: true,
                      onClick: () => {
                        const target = menuFor
                        setMenuFor(null)
                        safety.openReport({
                          name: target.authorName,
                          userId: target.authorId,
                          type: 'photo',
                          targetId: target.id,
                        })
                      },
                    },
                    {
                      label: `Bloquear a ${menuFor.authorName}`,
                      destructive: true,
                      onClick: () => {
                        const target = menuFor
                        setMenuFor(null)
                        safety.openBlock({ name: target.authorName, userId: target.authorId })
                      },
                    },
                    {
                      label: 'Ver perfil',
                      onClick: () => {
                        setMenuFor(null)
                        openAuthor(menuFor.authorId)
                      },
                    },
                  ]
            }
          />
        )}
        {confirmDelete && (
          <ActionSheet
            key="confirm"
            title="¿Eliminar publicación?"
            onClose={() => {
              setConfirmDelete(null)
              setMenuFor(null)
            }}
            actions={[{ label: 'Eliminar', destructive: true, onClick: () => remove(confirmDelete) }]}
          />
        )}
      </AnimatePresence>
      {safety.overlays}
      {error && (
        <p
          role="alert"
          className="absolute inset-x-6 bottom-20 z-40 rounded-xl bg-ig-text px-4 py-2.5 text-center text-sm text-white shadow-lg"
        >
          {error}
        </p>
      )}
    </>
  )

  return {
    myId,
    like,
    openComments: (p: WallPhoto) => setCommentsFor(p.id),
    openMenu: (p: WallPhoto) => setMenuFor(p),
    openAuthor,
    overlays,
  }
}
