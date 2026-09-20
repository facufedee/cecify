'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, AtSign, Loader2, MessageCircle, MoreVertical, Send } from 'lucide-react'
import ActionSheet from '@/components/wall/ActionSheet'
import { useSafety } from '@/components/safety/useSafety'
import { REALTIME_EVENTS, useRealtime } from '@/components/app/RealtimeProvider'
import { authFetch, getSessionUserId } from '@/lib/client-auth'
import { formatClock, formatDayLabel } from '@/lib/format'
import { getSocket } from '@/lib/socket'
import type { ChatMessage, Conversation } from '@/lib/db'

type Msg = ChatMessage & { pending?: boolean }

const MAX_LENGTH = 1000
const TYPING_RESEND_MS = 2500
const TYPING_TTL_MS = 5000
const POLL_CONNECTED_MS = 20_000
const POLL_FALLBACK_MS = 4_000
const ICEBREAKERS = ['¡Hola! 👋', '¿Qué tal la fiesta?', '¿Ya bailaste hoy? 💃']

// Fuera del componente: son valores efimeros del mensaje optimista, no parte del render
const tempMessage = (conversationId: string, fromUserId: string, content: string): Msg => ({
  id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  conversationId,
  fromUserId,
  content,
  createdAt: new Date().toISOString(),
  pending: true,
})

const mergeMessages = (prev: Msg[], incoming: Msg[]) => {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { connected, refreshUnread } = useRealtime()

  const [conv, setConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [showContact, setShowContact] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  // Bloquear o deshacer el match cierra el chat
  const safety = useSafety({
    onBlocked: () => router.replace('/matches'),
    onUnmatched: () => router.replace('/matches'),
  })

  const myId = getSessionUserId()
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastAt = useRef<string | null>(null)
  const lastTypingSent = useRef(0)
  const stopTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingTtl = useRef<ReturnType<typeof setTimeout> | null>(null)

  const markRead = useCallback(() => {
    authFetch(`/api/messages/${id}/read`, { method: 'POST' })
      .then(() => refreshUnread())
      .catch(() => {})
  }, [id, refreshUnread])

  // Carga inicial
  useEffect(() => {
    let cancelled = false
    authFetch(`/api/messages/${id}`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404 || res.status === 400) {
          setNotFound(true)
          return
        }
        if (!res.ok) throw new Error()
        const data = await res.json()
        setConv(data.conversation)
        setMessages(data.messages)
        markRead()
      })
      .catch(() => !cancelled && setError('No se pudo cargar la conversación'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id, markRead])

  useEffect(() => {
    lastAt.current = messages.filter((m) => !m.pending).at(-1)?.createdAt ?? null
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, typing])

  const receive = useCallback(
    (incoming: Msg[]) => {
      if (incoming.length === 0) return
      setMessages((prev) => mergeMessages(prev, incoming))
      if (incoming.some((m) => m.fromUserId !== myId)) markRead()
    },
    [markRead, myId]
  )

  // Tiempo real: mensajes y "escribiendo..." de esta conversacion
  useEffect(() => {
    const onMessage = (e: Event) => {
      const { message } = (e as CustomEvent<{ message: Msg }>).detail
      if (message.conversationId === id) {
        setTyping(false)
        receive([message])
      }
    }
    const onTyping = (e: Event) => {
      const d = (e as CustomEvent<{ conversationId: string; typing: boolean }>).detail
      if (d.conversationId !== id) return
      setTyping(d.typing)
      if (typingTtl.current) clearTimeout(typingTtl.current)
      if (d.typing) typingTtl.current = setTimeout(() => setTyping(false), TYPING_TTL_MS)
    }
    window.addEventListener(REALTIME_EVENTS.message, onMessage)
    window.addEventListener(REALTIME_EVENTS.typing, onTyping)
    return () => {
      window.removeEventListener(REALTIME_EVENTS.message, onMessage)
      window.removeEventListener(REALTIME_EVENTS.typing, onTyping)
    }
  }, [id, receive])

  // Polling: rapido si el socket no esta conectado, lento como red de seguridad si lo esta
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const after = lastAt.current
        const res = await authFetch(`/api/messages/${id}${after ? `?after=${encodeURIComponent(after)}` : ''}`)
        if (res.ok) receive((await res.json()).messages)
      } catch {}
    }, connected ? POLL_CONNECTED_MS : POLL_FALLBACK_MS)
    return () => clearInterval(poll)
  }, [id, connected, receive])

  const emitTyping = (isTyping: boolean) => {
    const socket = getSocket()
    if (!socket?.connected || !conv) return
    socket.emit('typing', { toUserId: conv.other.userId, conversationId: id, typing: isTyping })
  }

  const onInput = (value: string) => {
    setText(value)
    const now = Date.now()
    if (value && now - lastTypingSent.current > TYPING_RESEND_MS) {
      lastTypingSent.current = now
      emitTyping(true)
    }
    if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current)
    stopTypingTimer.current = setTimeout(() => {
      lastTypingSent.current = 0
      emitTyping(false)
    }, 3000)
  }

  const send = async (raw: string) => {
    const content = raw.trim()
    if (!content || !myId) return

    if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current)
    lastTypingSent.current = 0
    emitTyping(false)
    setError(null)
    setText('')

    const temp = tempMessage(id, myId, content)
    const tempId = temp.id
    setMessages((prev) => [...prev, temp])

    try {
      const res = await authFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id, content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo enviar el mensaje')
      setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== tempId), [data.message]))
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setText(content)
      setError(e instanceof Error ? e.message : 'No se pudo enviar el mensaje')
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-brand" />
      </div>
    )
  }

  if (notFound || !conv) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="font-semibold">{error ?? 'No encontramos esta conversación'}</p>
        <Link href="/matches" className="text-sm text-brand underline">
          Volver a mis matches
        </Link>
      </div>
    )
  }

  const { contact } = conv.other
  const hasContact = Boolean(contact.instagram || contact.whatsapp)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
        <button
          type="button"
          aria-label="Volver"
          onClick={() => router.push('/matches')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-600"
        >
          <ArrowLeft size={18} />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={conv.other.photo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold leading-tight">
            {conv.other.name}
            {conv.other.age > 0 && <span className="font-normal text-neutral-400">, {conv.other.age}</span>}
          </h1>
          <p className={`h-4 text-xs ${typing ? 'text-brand' : 'text-transparent'}`} aria-live="polite">
            {typing ? 'escribiendo…' : '.'}
          </p>
        </div>
        {hasContact && (
          <button
            type="button"
            onClick={() => setShowContact((v) => !v)}
            aria-expanded={showContact}
            className="shrink-0 rounded-xl bg-brand-soft px-3 py-2 text-xs font-semibold text-brand"
          >
            Contacto
          </button>
        )}
        <button
          type="button"
          onClick={() => setMenu(true)}
          aria-label="Más opciones"
          className="shrink-0 p-1.5 text-neutral-500"
        >
          <MoreVertical size={20} />
        </button>
      </header>

      {showContact && hasContact && (
        <div className="space-y-2 border-b border-neutral-100 bg-cream/50 px-4 py-3">
          <p className="text-xs text-neutral-500">Ya se gustaron: también pueden seguir la charla por acá.</p>
          <div className="flex flex-wrap gap-2">
            {contact.instagram && (
              <a
                href={`https://instagram.com/${contact.instagram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium shadow-sm"
              >
                <AtSign size={16} className="text-brand" /> @{contact.instagram}
              </a>
            )}
            {contact.whatsapp && (
              <a
                href={`https://wa.me/${contact.whatsapp.replace(/^\+/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium shadow-sm"
              >
                <MessageCircle size={16} className="text-brand" /> WhatsApp
              </a>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={conv.other.photo} alt="" className="h-24 w-24 rounded-full object-cover shadow" />
            <p className="mt-4 text-lg font-semibold">¡Hicieron match!</p>
            <p className="mt-1 text-sm text-neutral-500">Rompé el hielo y escribile a {conv.other.name}.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {ICEBREAKERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-brand px-3.5 py-1.5 text-sm text-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-1.5">
            {messages.map((m, i) => {
              const mine = m.fromUserId === myId
              const newDay = i === 0 || new Date(messages[i - 1].createdAt).toDateString() !== new Date(m.createdAt).toDateString()
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <li className="py-2 text-center text-xs capitalize text-neutral-400">
                      {formatDayLabel(m.createdAt)}
                    </li>
                  )}
                  <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${
                        mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-cream text-neutral-800'
                      } ${m.pending ? 'opacity-60' : ''}`}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-neutral-400'}`}>
                        {m.pending ? 'enviando…' : formatClock(m.createdAt)}
                      </p>
                    </div>
                  </li>
                </Fragment>
              )
            })}
            {typing && (
              <li className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-cream px-4 py-2.5 text-neutral-400" aria-hidden>
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                  </span>
                </div>
              </li>
            )}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" className="px-4 pb-1 text-center text-xs text-red-600">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
        className="flex items-center gap-2 border-t border-neutral-100 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      >
        <input
          value={text}
          onChange={(e) => onInput(e.target.value)}
          maxLength={MAX_LENGTH}
          placeholder="Escribí un mensaje…"
          aria-label="Mensaje"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-full bg-cream px-4 py-3 text-sm outline-none ring-1 ring-transparent transition placeholder:text-neutral-400 focus:bg-white focus:ring-brand"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Enviar"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition disabled:opacity-40"
        >
          <Send size={18} />
        </button>
      </form>

      {safety.overlays}
      <AnimatePresence>
        {menu && (
          <ActionSheet
            key="menu"
            onClose={() => setMenu(false)}
            actions={[
              {
                label: 'Reportar',
                destructive: true,
                onClick: () => {
                  setMenu(false)
                  safety.openReport({ name: conv.other.name, userId: conv.other.userId, type: 'chat', conversationId: id })
                },
              },
              {
                label: 'Deshacer match',
                onClick: () => {
                  setMenu(false)
                  safety.openUnmatch(id, conv.other.name)
                },
              },
              {
                label: 'Bloquear',
                destructive: true,
                onClick: () => {
                  setMenu(false)
                  safety.openBlock({ name: conv.other.name, userId: conv.other.userId })
                },
              },
            ]}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
