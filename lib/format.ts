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
