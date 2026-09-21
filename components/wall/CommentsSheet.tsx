'use client'

import { useDialog } from '@/components/a11y/useDialog'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Flag, Loader2 } from 'lucide-react'
import StoryRing from '@/components/wall/StoryRing'
import { authFetch } from '@/lib/client-auth'
import { formatShortAgo } from '@/lib/format'
import type { WallComment, WallPhoto } from '@/lib/db'

const MAX_LENGTH = 300

export default function CommentsSheet({
  photo,
  myId,
  onClose,
  onAdded,
  onReport,
}: {
  photo: WallPhoto
  myId: string | null
  onClose: () => void
  onAdded: (photoId: string) => void
  onReport: (comment: WallComment) => void
}) {
  const [comments, setComments] = useState<WallComment[] | null>(null)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const dialogRef = useDialog<HTMLDivElement>(onClose)
  useEffect(() => {
    let cancelled = false
    authFetch(`/api/photos/${photo.id}/comments`)
      .then(async (res) => {
        if (!res.ok) throw new Error()
        if (!cancelled) setComments((await res.json()).comments)
      })
      .catch(() => !cancelled && setError('No se pudieron cargar los comentarios'))
    return () => {
      cancelled = true
    }
  }, [photo.id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [comments?.length])

  const post = async () => {
    const content = text.trim()
    if (!content || posting) return
    setPosting(true)
    setError(null)
    try {
      const res = await authFetch(`/api/photos/${photo.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo publicar el comentario')
      setComments((prev) => [...(prev ?? []), data.comment])
      setText('')
      onAdded(photo.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo publicar el comentario')
    } finally {
      setPosting(false)
    }
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col justify-end bg-black/50 font-ig text-ig-text"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Comentarios"
        className="outline-none flex h-[78%] flex-col rounded-t-2xl bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-ig-soft py-3 text-center">
          <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-ig-border" />
          <h2 className="text-base font-semibold">Comentarios</h2>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {photo.caption && (
            <div className="flex gap-3">
              <StoryRing src={photo.authorPhoto} size={34} ring={false} />
              <p className="text-sm">
                <span className="mr-1.5 font-semibold">{photo.authorName}</span>
                {photo.caption}
                <span className="mt-0.5 block text-xs text-ig-muted">{formatShortAgo(photo.createdAt)}</span>
              </p>
            </div>
          )}

          {comments === null && !error && (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-ig-muted" />
            </div>
          )}

          {comments?.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-lg font-bold">Aún no hay comentarios.</p>
              <p className="mt-1 text-sm text-ig-muted">Inicia la conversación.</p>
            </div>
          )}

          {comments?.map((c) => (
            <div key={c.id} className="flex gap-3">
              <StoryRing src={c.authorPhoto} size={34} ring={false} />
              <p className="text-sm">
                <span className="mr-1.5 font-semibold">{c.authorName}</span>
                {c.body}
                <span className="mt-0.5 block text-xs text-ig-muted">{formatShortAgo(c.createdAt)}</span>
              </p>
              {c.authorId !== myId && (
                <button
                  type="button"
                  onClick={() => onReport(c)}
                  aria-label={`Reportar el comentario de ${c.authorName}`}
                  className="ml-auto shrink-0 self-start p-1 text-ig-muted"
                >
                  <Flag size={14} />
                </button>
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {error && (
          <p role="alert" className="px-4 pb-1 text-center text-xs text-ig-like">
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void post()
          }}
          className="flex items-center gap-3 border-t border-ig-soft px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_LENGTH}
            placeholder="Agrega un comentario..."
            aria-label="Comentario"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ig-muted"
          />
          <button
            type="submit"
            disabled={!text.trim() || posting}
            className="text-sm font-semibold text-ig-link disabled:opacity-40"
          >
            Publicar
          </button>
        </form>
      </motion.div>
    </motion.div>
  )
}
