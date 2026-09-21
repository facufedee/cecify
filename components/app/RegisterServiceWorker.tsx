'use client'

import { useEffect } from 'react'
import { PUSH_FLAG } from '@/lib/push-client'

// En produccion registra el service worker. En desarrollo lo da de baja y limpia sus caches (un service worker
// viejo en localhost sirve archivos desactualizados y rompe el hot reload), salvo que se hayan activado las
// notificaciones: ahi se registra, y sw.js no cachea nada en localhost.
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
      return
    }

    let pushOn = false
    try {
      pushOn = localStorage.getItem(PUSH_FLAG) === '1'
    } catch {}
    if (pushOn) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
      return
    }

    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => registrations.forEach((r) => r.unregister()))
      .catch(() => {})
    caches
      ?.keys()
      .then((names) => names.forEach((n) => caches.delete(n)))
      .catch(() => {})
  }, [])

  return null
}
