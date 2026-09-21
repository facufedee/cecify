'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Heart, Loader2 } from 'lucide-react'
import PushPrompt from '@/components/app/PushPrompt'
import { REALTIME_EVENTS, useRealtime } from '@/components/app/RealtimeProvider'
import { authFetch } from '@/lib/client-auth'
import { formatListTime } from '@/lib/format'
import type { Conversation } from '@/lib/db'

const POLL_CONNECTED_MS = 30_000
const POLL_FALLBACK_MS = 8_000

export default function MatchesPage() {
  const { connected } = useRealtime()
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/matches')
      if (!res.ok) throw new Error()
      setConversations((await res.json()).conversations)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const refresh = () => void load()
    window.addEventListener(REALTIME_EVENTS.message, refresh)
    window.addEventListener(REALTIME_EVENTS.match, refresh)
    window.addEventListener('focus', refresh)
    const poll = setInterval(refresh, connected ? POLL_CONNECTED_MS : POLL_FALLBACK_MS)
    return () => {
      window.removeEventListener(REALTIME_EVENTS.message, refresh)
      window.removeEventListener(REALTIME_EVENTS.match, refresh)
      window.removeEventListener('focus', refresh)
      clearTimeout(first)
      clearInterval(poll)
    }
  }, [load, connected])

  if (conversations === null) {
    return (
      <div className="flex h-full items-center justify-center">
        {failed ? (
          <button type="button" onClick={load} className="text-sm text-brand underline">
            No se pudieron cargar tus matches. Reintentar
          </button>
        ) : (
          <Loader2 className="animate-spin text-brand" />
        )}
      </div>
    )
  }

  const fresh = conversations.filter((c) => !c.lastMessage)
  const talking = conversations.filter((c) => c.lastMessage)

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col justify-center">
        <PushPrompt />
        <div className="flex flex-col items-center px-8 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Heart size={30} />
        </span>
        <h1 className="mt-4 text-xl font-semibold">Todavía no tenés matches</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Cuando vos y otro invitado se den like, van a aparecer acá para chatear.
        </p>
        <Link
          href="/discover"
          className="mt-5 rounded-2xl bg-brand px-6 py-2.5 text-sm font-medium text-white"
        >
          Ir a descubrir
        </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="px-6 pb-2 pt-5">
        <h1 className="text-2xl font-semibold">Tus matches</h1>
      </header>
      <PushPrompt />

      {fresh.length > 0 && (
        <section className="pb-2">
          <h2 className="px-6 pb-2 text-sm font-semibold text-neutral-500">Nuevos matches</h2>
          <ul className="flex gap-4 no-scrollbar overflow-x-auto px-6 pb-2">
            {fresh.map((c) => (
              <li key={c.id} className="shrink-0">
                <Link href={`/matches/${c.id}`} className="flex w-16 flex-col items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.other.photo}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover ring-2 ring-brand ring-offset-2"
                  />
                  <span className="w-full truncate text-center text-xs font-medium">{c.other.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {talking.length > 0 && (
        <section className="flex-1">
          <h2 className="px-6 pb-1 pt-2 text-sm font-semibold text-neutral-500">Mensajes</h2>
          <ul>
            {talking.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/matches/${c.id}`}
                  className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-cream/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img loading="lazy" decoding="async" src={c.other.photo} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">{c.other.name}</span>
                      <span className="shrink-0 text-xs text-neutral-500">
                        {formatListTime(c.lastMessage!.at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`truncate text-sm ${
                          c.unread > 0 ? 'font-medium text-neutral-800' : 'text-neutral-500'
                        }`}
                      >
                        {c.lastMessage!.fromMe && 'Vos: '}
                        {c.lastMessage!.content}
                      </p>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
