const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

// Hora si es de hoy; "Ayer"; si no, dd/mm
export const formatListTime = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Ayer'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

export const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export const formatDayLabel = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return 'Hoy'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Ayer'
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// Tiempo corto como en Instagram: "ahora", "47 min", "3 h", "2 d"; pasada una semana, la fecha
export const formatShortAgo = (iso: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'ahora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d`
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}

// Codigo de acceso legible: ABCD1234 -> ABCD-1234
export const prettyCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`
