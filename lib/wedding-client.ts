'use client'

// El casamiento del lado del navegador: el codigo guardado en el celular y los nombres de la pareja
// (se piden una sola vez por sesion y se comparten entre todas las pantallas).
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { getToken } from '@/lib/client-auth'
import { sideLabels, type CoupleNames } from '@/lib/profile-schema'
import { parseWeddingCode } from '@/lib/wedding-code'

export const WEDDING_CODE_KEY = 'lovify_wedding_code'

// Codigo del ultimo casamiento al que se entro (o del link /c/CODIGO). null si no hay o esta roto.
export const readWeddingCode = (): string | null => {
  try {
    return parseWeddingCode(localStorage.getItem(WEDDING_CODE_KEY)) ?? null
  } catch {
    return null
  }
}

// Guarda el codigo normalizado y lo devuelve; uno mal formado no se guarda (null)
export const rememberWeddingCode = (raw: string): string | null => {
  const code = parseWeddingCode(raw)
  if (!code) return null
  try {
    localStorage.setItem(WEDDING_CODE_KEY, code)
  } catch {}
  return code
}

export const forgetWeddingCode = () => {
  try {
    localStorage.removeItem(WEDDING_CODE_KEY)
  } catch {}
}

// Link para compartir con los invitados: guarda el codigo y lleva a /login
export const shareLink = (origin: string, code: string) => `${origin.replace(/\/+$/, '')}/c/${code}`

// Lo que devuelve GET /api/wedding. Los organizadores ademas reciben el codigo y el horario de registro.
export type WeddingInfo = CoupleNames & { code?: string; opensAt?: string | null; closesAt?: string | null }

// Cache por token: una sesion nueva (otra cuenta) vuelve a pedirlo; mientras tanto se muestra lo anterior
type Entry = { token: string; data: WeddingInfo | null; loading: boolean }
let entry: Entry | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const ensureWedding = () => {
  const token = getToken()
  if (!token) return
  if (entry && entry.token === token && (entry.data || entry.loading)) return
  const mine: Entry = { token, data: entry?.data ?? null, loading: true }
  entry = mine
  // fetch comun (no authFetch): si falla no saca a nadie de la app, solo quedan los textos neutros
  fetch('/api/wedding', { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => (res.ok ? res.json() : null))
    .then((d: WeddingInfo | null) => {
      if (entry !== mine) return
      if (d && typeof d.partnerA === 'string' && typeof d.partnerB === 'string') entry = { ...mine, data: d, loading: false }
      else entry = { ...mine, loading: false }
      emit()
    })
    .catch(() => {
      if (entry === mine) entry = { ...mine, loading: false } // se reintenta en el proximo montaje
    })
}

// Despues de editar los nombres en el panel: todas las pantallas los ven sin volver a pedirlos
export const setWeddingNames = (names: CoupleNames) => {
  if (!entry?.data) return
  entry = { ...entry, data: { ...entry.data, ...names } }
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const snapshot = () => entry?.data ?? null
const serverSnapshot = () => null

// El casamiento de quien tiene sesion (null mientras carga o si fallo)
export const useWedding = (): WeddingInfo | null => {
  useEffect(ensureWedding, [])
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

// Etiquetas "Del lado de ..." con los nombres del casamiento
export const useSideLabels = () => {
  const wedding = useWedding()
  return useMemo(() => sideLabels(wedding), [wedding])
}
