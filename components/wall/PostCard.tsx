'use client'

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Heart, MessageCircle, MoreHorizontal } from 'lucide-react'
import StoryRing from '@/components/wall/StoryRing'
import { formatShortAgo } from '@/lib/format'
import type { WallPhoto } from '@/lib/db'

type Props = {
  photo: WallPhoto
  onLike: (photo: WallPhoto) => void
  onOpenComments: (photo: WallPhoto) => void
  onOpenMenu: (photo: WallPhoto) => void
  onOpenAuthor: (authorId: string) => void
}

const DOUBLE_TAP_MS = 300
const CAPTION_CLAMP = 90

export default function PostCard({ photo, onLike, onOpenComments, onOpenMenu, onOpenAuthor }: Props) {
  const [burst, setBurst] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const lastTap = useRef(0)

  // Doble toque sobre la foto = me gusta (no lo quita si ya estaba)
  const onPhotoTap = () => {
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      setBurst((n) => n + 1)
      setTimeout(() => setBurst(0), 900)
      if (!photo.likedByMe) onLike(photo)
    } else {
      lastTap.current = now
    }
  }

  const long = (photo.caption?.length ?? 0) > CAPTION_CLAMP

  return (
    <article className="pb-4 font-ig text-ig-text">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <button type="button" onClick={() => onOpenAuthor(photo.authorId)} aria-label={`Ver perfil de ${photo.authorName}`} className="tap relative">
          <StoryRing src={photo.authorPhoto} size={34} ring={false} />
        </button>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <button
            type="button"
            onClick={() => onOpenAuthor(photo.authorId)}
            className="truncate text-sm font-semibold"
          >
            {photo.authorName}
          </button>
          <span className="shrink-0 text-sm text-ig-muted">• {formatShortAgo(photo.createdAt)}</span>
        </div>
        <button type="button" onClick={() => onOpenMenu(photo)} aria-label="Más opciones" className="tap relative p-1">
          <MoreHorizontal size={22} />
        </button>
      </header>

      <div className="relative select-none overflow-hidden border-y border-ig-soft bg-ig-soft" onClick={onPhotoTap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.photoUrl}
          alt={photo.caption ?? `Foto de ${photo.authorName}`}
          draggable={false}
          loading="lazy"
          decoding="async"
          className="max-h-[36rem] w-full object-cover"
        />
        <AnimatePresence>
          {burst > 0 && (
            <motion.span
              key={burst}
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-white drop-shadow-lg"
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: [0.3, 1.2, 1], opacity: [0, 1, 1] }}
              exit={{ scale: 1.25, opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Heart size={96} fill="currentColor" strokeWidth={0} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-4 px-3 pt-2.5">
        <motion.button
          type="button"
          whileTap={{ scale: 0.8 }}
          onClick={() => onLike(photo)}
          aria-label={photo.likedByMe ? 'Quitar me gusta' : 'Me gusta'}
          aria-pressed={photo.likedByMe}
          className="tap relative"
        >
          <Heart
            size={26}
            strokeWidth={photo.likedByMe ? 0 : 2}
            className={photo.likedByMe ? 'text-ig-like' : 'text-ig-text'}
            fill={photo.likedByMe ? 'currentColor' : 'none'}
          />
        </motion.button>
        <button type="button" onClick={() => onOpenComments(photo)} aria-label="Comentar" className="tap relative">
          <MessageCircle size={26} />
        </button>
      </div>

      <div className="space-y-1 px-3 pt-2 text-sm">
        {photo.likesCount > 0 && <p className="font-semibold">{photo.likesCount} Me gusta</p>}

        {photo.caption && (
          <p className={expanded || !long ? '' : 'line-clamp-2'}>
            <button type="button" onClick={() => onOpenAuthor(photo.authorId)} className="mr-1.5 font-semibold">
              {photo.authorName}
            </button>
            {photo.caption}
            {long && !expanded && (
              <button type="button" onClick={() => setExpanded(true)} className="ml-1 text-ig-muted">
                más
              </button>
            )}
          </p>
        )}

        <button type="button" onClick={() => onOpenComments(photo)} className="block text-ig-muted">
          {photo.commentsCount === 0
            ? 'Agrega un comentario...'
            : photo.commentsCount === 1
              ? 'Ver 1 comentario'
              : `Ver los ${photo.commentsCount} comentarios`}
        </button>
      </div>
    </article>
  )
}
