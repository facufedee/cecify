'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Eye, Loader2, MoreHorizontal, X } from 'lucide-react'
import ActionSheet from '@/components/wall/ActionSheet'
import StoryRing from '@/components/wall/StoryRing'
import { useSafety } from '@/components/safety/useSafety'
import { authFetch } from '@/lib/client-auth'
import { formatShortAgo } from '@/lib/format'
import type { Story, StoryAuthor, StoryViewerInfo } from '@/lib/db'

const DURATION = 5000 // ms por historia
const TICK = 50
const TAP_MS = 250

type Sheet = 'menu' | 'confirm' | 'viewers' | null

// Visor a pantalla completa: barras de progreso, toque izquierdo/derecho, mantener para pausar.
// Recorre las historias del autor y sigue con el siguiente de la cola, como en Instagram.
export default function StoryViewer({
  queue,
  myId,
  onClose,
}: {
  queue: StoryAuthor[]
  myId: string | null
  onClose: () => void
}) {
  const [ai, setAi] = useState(0)
  const [si, setSi] = useState(0)
  const [byAuthor, setByAuthor] = useState<Record<string, Story[]>>({})
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [viewers, setViewers] = useState<StoryViewerInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bloquear a quien publico la historia cierra el visor
  const safety = useSafety({ onBlocked: () => onClose() })

  const goLast = useRef(false) // al retroceder de autor, arrancar por su ultima historia
  const elapsedRef = useRef(0)
  const press = useRef<{ t: number; x: number } | null>(null)
  const seenSent = useRef(new Set<string>())
  const nextRef = useRef<() => void>(() => {})

  const author = queue[ai]
  const stories = author ? byAuthor[author.authorId] : undefined
  const story = stories?.[si]
  const isMine = author?.authorId === myId

  const goTo = useCallback((nextAi: number, nextSi: number) => {
    elapsedRef.current = 0
    setElapsed(0)
    setAi(nextAi)
    setSi(nextSi)
  }, [])

  const next = useCallback(() => {
    if (stories && si < stories.length - 1) return goTo(ai, si + 1)
    if (ai < queue.length - 1) {
      goLast.current = false
      return goTo(ai + 1, 0)
    }
    onClose()
  }, [stories, si, ai, queue.length, goTo, onClose])

  const prev = useCallback(() => {
    if (si > 0) return goTo(ai, si - 1)
    if (ai > 0) {
      const cached = byAuthor[queue[ai - 1].authorId]
      if (cached) return goTo(ai - 1, Math.max(0, cached.length - 1))
      goLast.current = true
      return goTo(ai - 1, 0)
    }
    goTo(ai, 0) // primera historia: reinicia
  }, [si, ai, goTo, byAuthor, queue])

  useEffect(() => {
    nextRef.current = next
  })

  // Carga las historias del autor actual (una vez) y elige por cual empezar
  useEffect(() => {
    if (!author || byAuthor[author.authorId]) return
    let cancelled = false
    authFetch(`/api/stories?author=${author.authorId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error()
        const { stories: list } = (await res.json()) as { stories: Story[] }
        if (cancelled) return
        setByAuthor((prev) => ({ ...prev, [author.authorId]: list }))
        const firstUnseen = list.findIndex((s) => !s.seenByMe)
        const start = goLast.current ? list.length - 1 : firstUnseen === -1 ? 0 : firstUnseen
        goLast.current = false
        elapsedRef.current = 0
        setElapsed(0)
        setSi(Math.max(0, start))
      })
      .catch(() => !cancelled && setError('No se pudieron cargar las historias'))
    return () => {
      cancelled = true
    }
  }, [author, byAuthor])

  // Autor sin historias vigentes (vencieron mientras tanto): pasa al siguiente
  useEffect(() => {
    if (stories && stories.length === 0) nextRef.current()
  }, [stories])

  // Reloj de la historia actual
  useEffect(() => {
    if (!story || paused || sheet || safety.busy) return
    const timer = setInterval(() => {
      elapsedRef.current += TICK
      if (elapsedRef.current >= DURATION) {
        nextRef.current()
      } else {
        setElapsed(elapsedRef.current)
      }
    }, TICK)
    return () => clearInterval(timer)
  }, [story, paused, sheet, safety.busy])

  // Marca como vista (una vez por historia, solo las ajenas)
  useEffect(() => {
    if (!story || !author || isMine || seenSent.current.has(story.id)) return
    seenSent.current.add(story.id)
    const authorId = author.authorId
    authFetch(`/api/stories/${story.id}/view`, { method: 'POST' })
      .then(() =>
        setByAuthor((prev) => ({
          ...prev,
          [authorId]: prev[authorId]?.map((s) => (s.id === story.id ? { ...s, seenByMe: true } : s)),
        }))
      )
      .catch(() => {})
  }, [story, author, isMine])

  // Precarga la foto siguiente
  useEffect(() => {
    const upcoming = stories?.[si + 1]?.photoUrl
    if (upcoming) new Image().src = upcoming
  }, [stories, si])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') nextRef.current()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev])

  const openViewers = async () => {
    if (!story) return
    setSheet('viewers')
    setViewers(null)
    try {
      const res = await authFetch(`/api/stories/${story.id}/viewers`)
      if (!res.ok) throw new Error()
      setViewers((await res.json()).viewers)
    } catch {
      setViewers([])
    }
  }

  const remove = async () => {
    if (!story || !author) return
    setSheet(null)
    try {
      const res = await authFetch(`/api/stories/${story.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      const remaining = (stories ?? []).filter((s) => s.id !== story.id)
      setByAuthor((prev) => ({ ...prev, [author.authorId]: remaining }))
      if (remaining.length === 0) return onClose()
      goTo(ai, Math.min(si, remaining.length - 1))
    } catch {
      setError('No se pudo eliminar la historia')
      setTimeout(() => setError(null), 3000)
    }
  }

  const stop = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <motion.div
      className="absolute inset-0 z-50 select-none bg-black font-ig text-white"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {story && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={story.id}
          src={story.photoUrl}
          alt={story.caption ?? `Historia de ${author.name}`}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {!story && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {error && !story && (
        <p role="alert" className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm">
          {error}
        </p>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />

      {/* Zona tactil: toque izquierdo = anterior, derecho = siguiente, mantener = pausa */}
      <div
        className="absolute inset-0"
        onPointerDown={(e) => {
          press.current = { t: Date.now(), x: e.clientX }
          setPaused(true)
        }}
        onPointerUp={(e) => {
          setPaused(false)
          const p = press.current
          press.current = null
          if (!p || Date.now() - p.t > TAP_MS || Math.abs(e.clientX - p.x) > 20) return
          const box = e.currentTarget.getBoundingClientRect()
          if ((e.clientX - box.left) / box.width < 0.33) prev()
          else next()
        }}
        onPointerCancel={() => {
          press.current = null
          setPaused(false)
        }}
        onPointerLeave={() => {
          if (press.current) {
            press.current = null
            setPaused(false)
          }
        }}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 px-3 pt-3">
        <div className="flex gap-1" aria-hidden>
          {(stories ?? [{ id: 'placeholder' }]).map((s, i) => (
            <span key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
              <span
                className="block h-full bg-white"
                style={{ width: `${i < si ? 100 : i === si ? Math.min(100, (elapsed / DURATION) * 100) : 0}%` }}
              />
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <StoryRing src={author?.photo ?? ''} size={34} ring={false} />
          <span className="text-sm font-semibold drop-shadow">{isMine ? 'Tu historia' : author?.name}</span>
          {story && <span className="text-sm text-white/75">{formatShortAgo(story.createdAt)}</span>}
          <span className="flex-1" />
          {story && (
            <button
              type="button"
              aria-label="Más opciones"
              onPointerDown={stop}
              onPointerUp={stop}
              onClick={() => setSheet('menu')}
              className="pointer-events-auto p-1.5"
            >
              <MoreHorizontal size={24} />
            </button>
          )}
          <button
            type="button"
            aria-label="Cerrar"
            onPointerDown={stop}
            onPointerUp={stop}
            onClick={onClose}
            className="pointer-events-auto p-1.5"
          >
            <X size={26} />
          </button>
        </div>
      </div>

      {story?.caption && (
        <p className="pointer-events-none absolute inset-x-6 bottom-20 text-center">
          <span className="inline-block max-w-full rounded-lg bg-black/50 px-3.5 py-2 text-lg font-semibold leading-snug">
            {story.caption}
          </span>
        </p>
      )}

      {isMine && story && (
        <button
          type="button"
          onPointerDown={stop}
          onPointerUp={stop}
          onClick={openViewers}
          className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-5 pb-5 pt-3 text-sm font-semibold"
        >
          <Eye size={20} />
          {story.viewsCount === 1 ? 'Visto por 1 persona' : `Visto por ${story.viewsCount ?? 0} personas`}
        </button>
      )}

      {error && story && (
        <p role="alert" className="absolute inset-x-6 bottom-24 rounded-xl bg-white px-4 py-2.5 text-center text-sm text-black shadow-lg">
          {error}
        </p>
      )}

      <AnimatePresence>
        {sheet === 'menu' && (
          <ActionSheet
            key="menu"
            onClose={() => setSheet(null)}
            actions={
              isMine
                ? [{ label: 'Eliminar', destructive: true, onClick: () => setSheet('confirm') }]
                : [
                    {
                      label: 'Reportar',
                      destructive: true,
                      onClick: () => {
                        setSheet(null)
                        if (story && author) {
                          safety.openReport({
                            name: author.name,
                            userId: author.authorId,
                            type: 'story',
                            targetId: story.id,
                          })
                        }
                      },
                    },
                    {
                      label: `Bloquear a ${author?.name}`,
                      destructive: true,
                      onClick: () => {
                        setSheet(null)
                        if (author) safety.openBlock({ name: author.name, userId: author.authorId })
                      },
                    },
                  ]
            }
          />
        )}
        {sheet === 'confirm' && (
          <ActionSheet
            key="confirm"
            title="¿Eliminar historia?"
            onClose={() => setSheet(null)}
            actions={[{ label: 'Eliminar', destructive: true, onClick: remove }]}
          />
        )}
        {sheet === 'viewers' && (
          <motion.div
            key="viewers"
            className="absolute inset-0 z-40 flex flex-col justify-end bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSheet(null)}
          >
            <motion.div
              role="dialog"
              aria-label="Vistas"
              className="flex max-h-[60%] flex-col rounded-t-2xl bg-white text-ig-text"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 40 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-ig-soft py-3 text-center">
                <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-ig-border" />
                <h2 className="text-base font-semibold">Vistas</h2>
              </div>
              <ul className="min-h-[8rem] overflow-y-auto px-4 py-3">
                {viewers === null && (
                  <li className="flex justify-center py-6">
                    <Loader2 className="animate-spin text-ig-muted" />
                  </li>
                )}
                {viewers?.length === 0 && (
                  <li className="py-8 text-center text-sm text-ig-muted">Todavía nadie vio esta historia.</li>
                )}
                {viewers?.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2">
                    <StoryRing src={v.photo} size={40} ring={false} />
                    <span className="flex-1 text-sm font-semibold">{v.name}</span>
                    <span className="text-xs text-ig-muted">{formatShortAgo(v.viewedAt)}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {safety.overlays}
    </motion.div>
  )
}
