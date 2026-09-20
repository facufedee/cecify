'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, Heart, LayoutGrid, Loader2, MessageCircle } from 'lucide-react'
import PostCard from '@/components/wall/PostCard'
import StoryRing from '@/components/wall/StoryRing'
import { usePostActions } from '@/components/wall/usePostActions'
import { authFetch, clearToken, getSessionUserId } from '@/lib/client-auth'
import { disconnectSocket } from '@/lib/socket'
import type { WallPhoto } from '@/lib/db'

type Author = { name: string; photo: string; bio: string }

// Perfil con grilla de fotos (estilo Instagram). Sin `userId` muestra el perfil propio.
export default function ProfileView({ userId }: { userId?: string }) {
  const router = useRouter()
  const [photos, setPhotos] = useState<WallPhoto[]>([])
  const [author, setAuthor] = useState<Author | null>(null)
  const [isMe, setIsMe] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading')
  const [viewing, setViewing] = useState<string | null>(null)
  const actions = usePostActions(photos, setPhotos)

  useEffect(() => {
    let cancelled = false
    const mine = getSessionUserId()
    const target = userId ?? mine
    if (!target) return

    authFetch(`/api/photos?author=${target}&limit=60`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) return setState('missing')
        if (!res.ok) throw new Error()
        const data = await res.json()
        setPhotos(data.photos)
        setAuthor(data.author)
        setIsMe(target === mine)
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [userId])

  // Si se borra la foto que se esta viendo, se cierra el visor
  const viewed = viewing ? photos.find((p) => p.id === viewing) : undefined

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-ig-muted" />
      </div>
    )
  }

  if (state !== 'ready' || !author) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center font-ig">
        <p className="font-semibold">
          {state === 'missing' ? 'No encontramos a este invitado' : 'No se pudo cargar el perfil'}
        </p>
        <button type="button" onClick={() => router.push('/photos')} className="text-sm font-semibold text-ig-link">
          Volver al muro
        </button>
      </div>
    )
  }

  const totalLikes = photos.reduce((sum, p) => sum + p.likesCount, 0)

  return (
    <div className="relative flex h-full flex-col font-ig text-ig-text">
      <header className="flex items-center gap-3 border-b border-ig-soft px-4 py-3">
        {!isMe && (
          <button type="button" onClick={() => router.back()} aria-label="Volver" className="-ml-1 p-1">
            <ArrowLeft size={24} />
          </button>
        )}
        <h1 className="flex-1 truncate text-base font-bold">{author.name}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="px-4 pb-4 pt-4">
          <div className="flex items-center gap-6">
            <StoryRing src={author.photo} size={86} alt={author.name} />
            <dl className="flex flex-1 justify-around text-center">
              <div>
                <dt className="sr-only">Publicaciones</dt>
                <dd className="text-base font-semibold">{photos.length}</dd>
                <p className="text-sm">{photos.length === 1 ? 'publicación' : 'publicaciones'}</p>
              </div>
              <div>
                <dt className="sr-only">Me gusta recibidos</dt>
                <dd className="text-base font-semibold">{totalLikes}</dd>
                <p className="text-sm">me gusta</p>
              </div>
            </dl>
          </div>

          {author.bio && <p className="mt-3 text-sm">{author.bio}</p>}

          {isMe && (
            <div className="mt-4 flex gap-2">
              <Link
                href="/photos/new"
                className="flex-1 rounded-lg bg-ig-soft py-1.5 text-center text-sm font-semibold"
              >
                Nueva publicación
              </Link>
              <button
                type="button"
                onClick={() => {
                  disconnectSocket()
                  clearToken()
                  router.replace('/login')
                }}
                className="flex-1 rounded-lg bg-ig-soft py-1.5 text-sm font-semibold"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </section>

        <div className="flex justify-center border-t border-ig-border">
          <span className="-mt-px flex items-center border-t border-ig-text px-10 py-2.5" aria-label="Publicaciones">
            <LayoutGrid size={22} />
          </span>
        </div>

        {photos.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-ig-text">
              <Camera size={30} strokeWidth={1.5} />
            </span>
            <h2 className="mt-3 text-lg font-bold">Aún no hay publicaciones</h2>
            {isMe && (
              <Link href="/photos/new" className="mt-2 text-sm font-semibold text-ig-link">
                Comparte tu primera foto
              </Link>
            )}
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-0.5">
            {photos.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setViewing(p.id)}
                  aria-label={`Abrir publicación: ${p.caption ?? 'foto'}`}
                  className="group relative block aspect-square w-full overflow-hidden bg-ig-soft"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.photoUrl} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center gap-4 bg-black/35 text-sm font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="flex items-center gap-1">
                      <Heart size={18} fill="currentColor" strokeWidth={0} /> {p.likesCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle size={18} fill="currentColor" strokeWidth={0} /> {p.commentsCount}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewed && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <header className="flex items-center gap-3 border-b border-ig-soft px-4 py-3">
            <button type="button" onClick={() => setViewing(null)} aria-label="Volver" className="-ml-1 p-1">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-base font-bold">Publicaciones</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PostCard
              photo={viewed}
              onLike={actions.like}
              onOpenComments={actions.openComments}
              onOpenMenu={actions.openMenu}
              onOpenAuthor={() => setViewing(null)}
            />
          </div>
        </div>
      )}

      {actions.overlays}
    </div>
  )
}
