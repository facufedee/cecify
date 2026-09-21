'use client'

import { authFetch } from '@/lib/client-auth'

// unsupported  el navegador no sabe de notificaciones push
// needs-install iPhone/iPad: solo funcionan con la app instalada en la pantalla de inicio
// unavailable  el servidor no tiene las notificaciones configuradas
// blocked      la persona las bloqueo en el navegador (solo ella puede volver a permitirlas)
// off          se pueden activar
// on           este dispositivo las recibe
export type PushState = 'unsupported' | 'needs-install' | 'unavailable' | 'blocked' | 'off' | 'on'

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
// En desarrollo el service worker solo se registra si la persona activo las notificaciones (ver RegisterServiceWorker)
export const PUSH_FLAG = 'cecify_push'
const DISMISSED_KEY = 'cecify_push_prompt_dismissed'

const flag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PUSH_FLAG, '1')
    else localStorage.removeItem(PUSH_FLAG)
  } catch {}
}

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// La clave publica llega en base64 "url-safe"; el navegador la pide como bytes
const keyToBytes = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const registration = async () => {
  await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

// Se pregunta una sola vez por carga de la pagina (varias pantallas lo consultan). Si falla, se vuelve a intentar.
let configuredCheck: Promise<boolean> | null = null
const serverConfigured = () =>
  (configuredCheck ??= authFetch('/api/push/subscribe')
    .then(async (res) => res.ok && Boolean((await res.json()).configured))
    .catch(() => false)
    .then((ok) => {
      if (!ok) configuredCheck = null
      return ok
    }))

export const getPushState = async (): Promise<PushState> => {
  if (typeof window === 'undefined') return 'unsupported'
  if (isIos() && !isInstalled()) return 'needs-install'
  if (!supported()) return 'unsupported'
  if (!PUBLIC_KEY || !(await serverConfigured())) return 'unavailable'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'

  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'
}

// Pide permiso (tiene que llamarse desde un toque del usuario), suscribe este dispositivo y avisa al servidor
export const enablePush = async (): Promise<PushState> => {
  const state = await getPushState()
  if (state !== 'off') return state

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'

  flag(true)
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(PUBLIC_KEY!) })
  } catch {
    // Una suscripcion vieja hecha con otra clave bloquea la nueva: se descarta y se reintenta
    await sub?.unsubscribe()
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(PUBLIC_KEY!) })
  }

  const res = await authFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  if (!res.ok) {
    await sub.unsubscribe().catch(() => {})
    throw new Error('No se pudieron activar las notificaciones, probá de nuevo')
  }
  return 'on'
}

// Da de baja este dispositivo (en el servidor y en el navegador)
export const disablePush = async (): Promise<void> => {
  flag(false)
  const reg = await navigator.serviceWorker?.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await authFetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

// Al cerrar sesion: si el dispositivo se comparte, la siguiente persona no debe recibir avisos de esta
export const disablePushQuietly = () => disablePush().catch(() => {})

export const promptDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export const dismissPrompt = () => {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {}
}
