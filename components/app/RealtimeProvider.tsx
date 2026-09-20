'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authFetch, getToken } from '@/lib/client-auth'
import { connectSocket, disconnectSocket } from '@/lib/socket'

// Eventos del socket reenviados a la ventana para que cada pantalla escuche lo que le interesa
export const REALTIME_EVENTS = {
  message: 'cecify:message',
  typing: 'cecify:typing',
  match: 'cecify:match',
} as const

type Realtime = {
  connected: boolean // el servidor confirmo (evento 'ready'); si es false, las pantallas hacen polling
  unread: number
  refreshUnread: () => void
}

const RealtimeContext = createContext<Realtime>({
  connected: false,
  unread: 0,
  refreshUnread: () => {},
})

export const useRealtime = () => useContext(RealtimeContext)

const UNREAD_POLL_CONNECTED_MS = 60_000
const UNREAD_POLL_FALLBACK_MS = 8_000

type MatchToast = { conversationId: string | null; name: string }

export default function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [connected, setConnected] = useState(false)
  const [unread, setUnread] = useState(0)
  const [toast, setToast] = useState<MatchToast | null>(null)

  const refreshUnread = useCallback(async () => {
    try {
      const res = await authFetch('/api/messages/unread')
      if (res.ok) setUnread((await res.json()).unread)
    } catch {}
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) return

    const socket = connectSocket(token)
    const emit = (name: string, detail: unknown) =>
      window.dispatchEvent(new CustomEvent(name, { detail }))

    // 'ready' lo emite el servidor tras verificar el JWT: un servidor viejo nunca lo manda
    const onReady = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onMessage = (data: unknown) => {
      emit(REALTIME_EVENTS.message, data)
      void refreshUnread()
    }
    const onTyping = (data: unknown) => emit(REALTIME_EVENTS.typing, data)
    const onMatch = (data: { conversationId: string | null; name: string }) => {
      emit(REALTIME_EVENTS.match, data)
      setToast({ conversationId: data.conversationId, name: data.name })
      setTimeout(() => setToast(null), 6000)
    }

    socket.on('ready', onReady)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onDisconnect)
    socket.on('message:new', onMessage)
    socket.on('user:typing', onTyping)
    socket.on('match:created', onMatch)

    return () => {
      socket.off('ready', onReady)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onDisconnect)
      socket.off('message:new', onMessage)
      socket.off('user:typing', onTyping)
      socket.off('match:created', onMatch)
      disconnectSocket()
    }
  }, [refreshUnread])

  // Sin socket confirmado el contador se actualiza por polling (mas seguido)
  useEffect(() => {
    if (!getToken()) return
    const first = setTimeout(refreshUnread, 0)
    const poll = setInterval(refreshUnread, connected ? UNREAD_POLL_CONNECTED_MS : UNREAD_POLL_FALLBACK_MS)
    return () => {
      clearTimeout(first)
      clearInterval(poll)
    }
  }, [connected, refreshUnread])

  return (
    <RealtimeContext.Provider value={{ connected, unread, refreshUnread }}>
      {children}

      {toast && (
        <button
          type="button"
          onClick={() => {
            router.push(toast.conversationId ? `/matches/${toast.conversationId}` : '/matches')
            setToast(null)
          }}
          className="absolute inset-x-4 top-4 z-40 rounded-2xl bg-brand px-4 py-3 text-left text-sm font-medium text-white shadow-lg"
        >
          ¡Nuevo match con {toast.name}! <span className="font-normal text-white/80">Tocá para escribirle</span>
        </button>
      )}
    </RealtimeContext.Provider>
  )
}
