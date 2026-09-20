// Avisos en tiempo real: el servidor de sockets (Railway) solo entrega eventos.
// Toda la logica y los datos viven en las API routes; si el socket falla, la app sigue
// funcionando (los clientes hacen polling), por eso los errores aca nunca se propagan.
export type RealtimeEvent = 'message:new' | 'match:created'

export const emitTo = async (userId: string, event: RealtimeEvent, payload: unknown) => {
  const base = process.env.SOCKET_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SOCKET_URL
  const secret = process.env.SOCKET_SECRET
  if (!base || !secret) return

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/internal/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-socket-secret': secret },
      body: JSON.stringify({ userId, event, payload }),
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) console.warn(`[realtime] emit ${event} -> ${res.status}`)
  } catch (error) {
    console.warn('[realtime] emit fallo:', error instanceof Error ? error.message : error)
  }
}
