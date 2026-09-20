'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { Camera, Loader2, Plus, SquarePlus } from 'lucide-react'
import PostCard from '@/components/wall/PostCard'
import ActionSheet from '@/components/wall/ActionSheet'
import StoryRing from '@/components/wall/StoryRing'
import StoryViewer from '@/components/stories/StoryViewer'
import { usePostActions } from '@/components/wall/usePostActions'
import { REALTIME_EVENTS } from '@/components/app/RealtimeProvider'
import { authFetch } from '@/lib/client-auth'
import type { StoryAuthor, WallPhoto } from '@/lib/db'

const PAGE = 8

export default function PhotosPage() {
  const router = useRouter()
  const [rings, setRings] = useState<StoryAuthor[]>([])
  const [storyQueue, setStoryQueue] = useState<StoryAuthor[] | null>(null)
  const [createMenu, setCreateMenu] = useState(false)
  const [photos, setPhotos] = useState<WallPhoto[]>([])
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const [myPhoto, setMyPhoto] = useState('')

  const cursor = useRef<string | null>(null)
  const loading = useRef(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const actions = usePostActions(photos, setPhotos)

  const loadMore = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const qs = new URLSearchParams({ limit: String(PAGE) })
      if (cursor.current) qs.set('before', cursor.current)
      const res = await authFetch(`/api/photos?${qs}`)
      if (!res.ok) throw new Error()
      const { photos: page } = (await res.json()) as { photos: WallPhoto[] }
      setPhotos((prev) => {
        const known = new Set(prev.map((p) => p.id))
        return [...prev, ...page.filter((p) => !known.has(p.id))]
      })
      if (page.length > 0) cursor.current = page[page.length - 1].createdAt
      if (page.length < PAGE) setDone(true)
      setFailed(false)
    } catch {
      setFailed(true)
      setDone(true)
    } finally {
      loading.current = false
      setLoaded(true)
    }
  }, [])

  // Trae lo mas nuevo y actualiza contadores de lo que ya estaba (al volver a la app, al recibir un like)
  const refreshTop = useCallback(async () => {
    try {
      const res = await authFetch(`/api/photos?limit=${PAGE}`)
      if (!res.ok) return
      const { photos: fresh } = (await res.json()) as { photos: WallPhoto[] }
      setPhotos((prev) => {
        const byId = new Map(fresh.map((p) => [p.id, p]))
        const known = new Set(prev.map((p) => p.id))
        return [...fresh.filter((p) => !known.has(p.id)), ...prev.map((p) => byId.get(p.id) ?? p)]
      })
    } catch {}
  }, [])

  const loadRings = useCallback(async () => {
    try {
      const res = await authFetch('/api/stories')
      if (res.ok) setRings((await res.json()).rings)
    } catch {}
  }, [])

  useEffect(() => {
    const first = setTimeout(() => {
      void loadMore()
      void loadRings()
    }, 0)
    authFetch('/api/profiles/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMyPhoto(data?.profile?.mainPhotoUrl ?? ''))
      .catch(() => {})

    const refresh = () => {
      void refreshTop()
      void loadRings()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener(REALTIME_EVENTS.photoLike, refresh)
    return () => {
      clearTimeout(first)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(REALTIME_EVENTS.photoLike, refresh)
    }
  }, [loadMore, refreshTop, loadRings])

  // Scroll infinito
  useEffect(() => {
    const el = sentinel.current
    if (!el || done || !loaded) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void loadMore()
      },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [done, loaded, loadMore, photos.length])

  // Carrusel: "Tu historia" primero y despues los invitados con historias vigentes (las no vistas antes)
  const mine = rings.find((r) => r.authorId === actions.myId)
  const others = rings.filter((r) => r.authorId !== actions.myId)

  const openStories = (authorId: string) => {
    const ordered = mine ? [mine, ...others] : others
    const from = ordered.findIndex((r) => r.authorId === authorId)
    if (from >= 0) setStoryQueue(ordered.slice(from))
  }

  return (
    <div className="flex h-full flex-col font-ig text-ig-text">
      <header className="flex items-center justify-between px-4 py-3">
        <h1 className="text-2xl font-bold tracking-tight">Cecify</h1>
        <button type="button" onClick={() => setCreateMenu(true)} aria-label="Crear">
          <SquarePlus size={28} strokeWidth={1.75} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loaded && (
          <ul className="flex gap-4 no-scrollbar overflow-x-auto px-4 pb-3 pt-1">
            <li className="shrink-0">
              <div className="relative flex w-[68px] flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => (mine ? openStories(mine.authorId) : router.push('/stories/new'))}
                  aria-label={mine ? 'Ver tu historia' : 'Crear una historia'}
                >
                  <StoryRing src={myPhoto} size={64} ring={Boolean(mine)} />
                </button>
                <Link
                  href="/stories/new"
                  aria-label="Agregar a tu historia"
                  className="absolute right-0.5 top-11 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-ig-link text-white"
                >
                  <Plus size={12} strokeWidth={3.5} />
                </Link>
                <span className="w-full truncate text-center text-xs text-ig-muted">Tu historia</span>
              </div>
            </li>
            {others.map((r) => (
              <li key={r.authorId} className="shrink-0">
                <button
                  type="button"
                  onClick={() => openStories(r.authorId)}
                  aria-label={`Ver la historia de ${r.name}`}
                  className="flex w-[68px] flex-col items-center gap-1"
                >
                  <StoryRing src={r.photo} size={64} seen={!r.hasUnseen} />
                  <span className={`w-full truncate text-center text-xs ${r.hasUnseen ? '' : 'text-ig-muted'}`}>
                    {r.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!loaded && (
          <div className="space-y-6 px-3 pt-2" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="flex items-center gap-2.5 py-2">
                  <span className="h-9 w-9 rounded-full bg-ig-soft" />
                  <span className="h-3 w-28 rounded bg-ig-soft" />
                </div>
                <div className="aspect-[4/5] w-full bg-ig-soft" />
              </div>
            ))}
          </div>
        )}

        {loaded && photos.length === 0 && (
          <div className="flex flex-col items-center px-8 py-20 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-ig-text">
              <Camera size={36} strokeWidth={1.5} />
            </span>
            <h2 className="mt-4 text-xl font-bold">{failed ? 'No se pudo cargar el muro' : 'Aún no hay publicaciones'}</h2>
            <p className="mt-1 text-sm text-ig-muted">
              {failed ? 'Revisá tu conexión e intentá de nuevo.' : 'Las fotos de la boda van a aparecer acá.'}
            </p>
            <Link href="/photos/new" className="mt-4 text-sm font-semibold text-ig-link">
              Comparte tu primera foto
            </Link>
          </div>
        )}

        {photos.map((photo) => (
          <PostCard
            key={photo.id}
            photo={photo}
            onLike={actions.like}
            onOpenComments={actions.openComments}
            onOpenMenu={actions.openMenu}
            onOpenAuthor={actions.openAuthor}
          />
        ))}

        <div ref={sentinel} className="py-6 text-center text-sm text-ig-muted">
          {!done && loaded && <Loader2 className="mx-auto animate-spin" />}
          {done && photos.length > 0 && (
            <>
              <p className="font-semibold text-ig-text">Estás al día</p>
              <p>Has visto todas las publicaciones.</p>
            </>
          )}
        </div>
      </div>

      {actions.overlays}

      <AnimatePresence>
        {createMenu && (
          <ActionSheet
            key="create"
            title="Crear"
            onClose={() => setCreateMenu(false)}
            actions={[
              { label: 'Publicación', onClick: () => router.push('/photos/new') },
              { label: 'Historia', onClick: () => router.push('/stories/new') },
            ]}
          />
        )}
        {storyQueue && (
          <StoryViewer
            key="stories"
            queue={storyQueue}
            myId={actions.myId}
            onClose={() => {
              setStoryQueue(null)
              void loadRings()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
