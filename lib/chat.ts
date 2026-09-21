// Reglas del chat que no dependen de la pantalla (para poder probarlas). Sin imports de servidor.

export type ChatLike = { id: string; fromUserId: string; createdAt: string; pending?: boolean }

// Une listas de mensajes sin repetir (por id) y en orden cronologico
export const mergeMessages = <T extends ChatLike>(prev: T[], incoming: T[]): T[] => {
  const byId = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// Cursor para pedir los mensajes anteriores a `oldestCreatedAt`.
// El servidor trabaja con microsegundos y el cliente con milisegundos: se pide "hasta 1 ms despues" del
// mas viejo que ya tenemos para no saltear un mensaje que cayo en el mismo milisegundo. El que ya esta
// vuelve a venir y mergeMessages lo descarta.
export const olderCursor = (oldestCreatedAt: string) => new Date(new Date(oldestCreatedAt).getTime() + 1).toISOString()

// Id del ULTIMO mensaje propio que la otra persona ya leyo (el que lleva el "Visto"), o null.
// `readUpTo` es hasta cuando leyo: todo lo propio enviado hasta esa fecha esta leido.
// Se compara en milisegundos y con margen de 1 ms por la diferencia de precision con el servidor.
export const seenMessageId = (messages: ChatLike[], myId: string, readUpTo: string | null): string | null => {
  if (!readUpTo) return null
  const limit = new Date(readUpTo).getTime() + 1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.fromUserId === myId && !m.pending && new Date(m.createdAt).getTime() <= limit) return m.id
  }
  return null
}

// La fecha mas reciente de las dos (la lectura solo avanza, nunca retrocede)
export const laterOf = (a: string | null, b: string | null) => (!a ? b : !b ? a : a >= b ? a : b)

// Se sigue leyendo el final de la conversacion salvo que la persona haya subido a mirar mensajes viejos
export const isNearBottom = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }, margin = 120) =>
  el.scrollHeight - el.scrollTop - el.clientHeight <= margin
