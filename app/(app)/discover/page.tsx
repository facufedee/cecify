'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { Heart, Loader2, RotateCcw, X } from 'lucide-react'
import SwipeCard, { type SwipeAction, type SwipeCardHandle } from '@/components/discover/SwipeCard'
import ProfileSheet from '@/components/discover/ProfileSheet'
import MatchOverlay from '@/components/discover/MatchOverlay'
import ActionSheet from '@/components/wall/ActionSheet'
import { useSafety } from '@/components/safety/useSafety'
import { authFetch } from '@/lib/client-auth'
import type { DiscoverProfile } from '@/lib/profile-schema'

type MatchInfo = { name: string; mainPhotoUrl: string; conversationId: string | null }

export default function DiscoverPage() {
  const router = useRouter()
  const [deck, setDeck] = useState<DiscoverProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  // Cuantos de los que paso puede volver a ver cuando se termina el mazo
  const [skipped, setSkipped] = useState(0)
  const [restoring, setRestoring] = useState(false)
  const [info, setInfo] = useState<DiscoverProfile | null>(null)
  const [match, setMatch] = useState<MatchInfo | null>(null)
  const [myPhoto, setMyPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [safetyFor, setSafetyFor] = useState<DiscoverProfile | null>(null)
  // Al bloquear, la persona sale del mazo y se cierra el detalle
  const safety = useSafety({
    onBlocked: (t) => {
      setDeck((d) => d.filter((p) => p.id !== t.profileId))
      setInfo(null)
    },
  })

  const topCard = useRef<SwipeCardHandle>(null)
  const seen = useRef(new Set<string>()) // en el mazo o ya swipeados (evita repetir mientras el servidor registra)
  const fetching = useRef(false)

  const showError = useCallback((message: string) => {
    setError(message)
    setTimeout(() => setError(null), 3500)
  }, [])

  const fetchMore = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    try {
      const exclude = [...seen.current].slice(-50).join(',')
      const res = await authFetch(`/api/profiles/discover?exclude=${exclude}`)
      if (res.status === 403) {
        // Sin perfil -> onboarding; con "solo compartir momentos" -> al muro
        const { code } = await res.json().catch(() => ({ code: null }))
        router.replace(code === 'MATCH_DISABLED' ? '/photos' : '/onboarding')
        return
      }
      if (!res.ok) throw new Error()

      const { profiles, skipped: skippedNow } = (await res.json()) as { profiles: DiscoverProfile[]; skipped?: number }
      setSkipped(skippedNow ?? 0)
      const fresh = profiles.filter((p) => !seen.current.has(p.id))
      fresh.forEach((p) => seen.current.add(p.id))
      setDeck((d) => [...d, ...fresh])
      if (fresh.length === 0) setExhausted(true)
    } catch {
      showError('No se pudieron cargar más perfiles')
      setExhausted(true)
    } finally {
      fetching.current = false
      setLoaded(true)
    }
  }, [router, showError])

  useEffect(() => {
    authFetch('/api/profiles/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMyPhoto(data?.profile?.mainPhotoUrl ?? null))
      .catch(() => {})
  }, [])

  // Mantiene el mazo con al menos 3 tarjetas
  useEffect(() => {
    if (!exhausted && deck.length <= 2) void fetchMore()
  }, [deck.length, exhausted, fetchMore])

  // Precarga las imagenes de las proximas tarjetas para que al deslizar se vean al instante
  useEffect(() => {
    if (typeof window === 'undefined') return
    deck.slice(0, 4).forEach((p) => {
      if (p.mainPhotoUrl) {
        const img = new Image()
        img.src = p.mainPhotoUrl
      }
    })
  }, [deck])

  const onSwipe = async (profile: DiscoverProfile, action: SwipeAction) => {
    setDeck((d) => d.filter((p) => p.id !== profile.id))
    try {
      const res = await authFetch('/api/swipes/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profile.id, action }),
      })
      const data = await res.json()
      if (!res.ok) {
        showError(data.error ?? 'No se pudo guardar tu elección')
        return
      }
      if (data.matchCreated) {
        setMatch({
          ...(data.matchedProfile ?? { name: profile.name, mainPhotoUrl: profile.mainPhotoUrl }),
          conversationId: data.conversationId ?? null,
        })
      }
    } catch {
      showError('Sin conexión: no se guardó tu elección')
    }
  }

  const reload = () => {
    seen.current.clear()
    setDeck([])
    setExhausted(false)
    setLoaded(false)
  }

  const showSkipped = async () => {
    setRestoring(true)
    try {
      const res = await authFetch('/api/swipes/reset', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No se pudo')
      reload()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'No se pudo')
    } finally {
      setRestoring(false)
    }
  }

  const [top, next] = deck

  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pb-3 pt-5">
        <h1 className="text-2xl font-semibold">
          Descubrí a los <span className="text-brand">invitados</span>
        </h1>
        <p className="text-sm text-neutral-500">Deslizá a la derecha si querés conocer a alguien</p>
      </header>

      <div className="relative mx-5 min-h-0 flex-1">
        {!loaded && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="animate-spin text-brand" />
          </div>
        )}

        {loaded && !top && (
          <div className="flex h-full flex-col items-center justify-center rounded-[2rem] bg-cream px-8 text-center">
            <p className="text-lg font-semibold">Ya viste a todos por ahora</p>
            <p className="mt-1 text-sm text-neutral-500">
              {skipped > 0
                ? 'Podés darle otra oportunidad a los que pasaste, o esperar a que lleguen más invitados.'
                : 'Cuando lleguen más invitados los vas a ver acá.'}
            </p>
            {skipped > 0 && (
              <button
                type="button"
                onClick={showSkipped}
                disabled={restoring}
                className="mt-5 flex items-center gap-2 rounded-2xl bg-brand px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {restoring ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                Volver a ver los que pasaste ({skipped})
              </button>
            )}
            <button
              type="button"
              onClick={reload}
              className={
                skipped > 0
                  ? 'mt-3 text-sm font-medium text-brand underline'
                  : 'mt-5 flex items-center gap-2 rounded-2xl bg-brand px-5 py-2.5 text-sm font-medium text-white'
              }
            >
              {skipped === 0 && <RotateCcw size={16} />} Buscar de nuevo
            </button>
          </div>
        )}

        {next && (
          <div inert className="pointer-events-none absolute inset-0 origin-bottom scale-[0.94] opacity-90">
            <SwipeCard profile={next} interactive={false} onSwipe={() => {}} onInfo={() => {}} />
          </div>
        )}
        {top && (
          <SwipeCard
            key={top.id}
            profile={top}
            interactive
            handleRef={topCard}
            onSwipe={(action) => onSwipe(top, action)}
            onInfo={() => setInfo(top)}
          />
        )}
      </div>

      <div className="flex items-center justify-center gap-7 py-4">
        <button
          type="button"
          aria-label="Paso"
          disabled={!top}
          onClick={() => topCard.current?.swipe('skip')}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition active:scale-95 disabled:opacity-40"
        >
          <X size={26} />
        </button>
        <button
          type="button"
          aria-label="Me gusta"
          disabled={!top}
          onClick={() => topCard.current?.swipe('like')}
          className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-brand text-white shadow-md transition active:scale-95 disabled:opacity-40"
        >
          <Heart size={32} fill="currentColor" />
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="absolute inset-x-6 bottom-20 z-10 rounded-xl bg-neutral-800 px-4 py-2.5 text-center text-sm text-white shadow-lg"
        >
          {error}
        </p>
      )}

      <AnimatePresence>
        {info && (
          <ProfileSheet
            key="sheet"
            profile={info}
            onClose={() => setInfo(null)}
            onSafety={() => setSafetyFor(info)}
          />
        )}
        {safetyFor && (
          <ActionSheet
            key="safety"
            title={safetyFor.name}
            onClose={() => setSafetyFor(null)}
            actions={[
              {
                label: 'Reportar',
                destructive: true,
                onClick: () => {
                  safety.openReport({ name: safetyFor.name, profileId: safetyFor.id, type: 'profile' })
                  setSafetyFor(null)
                },
              },
              {
                label: 'Bloquear',
                destructive: true,
                onClick: () => {
                  safety.openBlock({ name: safetyFor.name, profileId: safetyFor.id })
                  setSafetyFor(null)
                },
              },
            ]}
          />
        )}
        {match && (
          <MatchOverlay
            key="match"
            myPhoto={myPhoto}
            other={match}
            onKeepGoing={() => setMatch(null)}
            onMessage={() => router.push(match.conversationId ? `/matches/${match.conversationId}` : '/matches')}
          />
        )}
      </AnimatePresence>
      {safety.overlays}
    </div>
  )
}
