'use client'

import { useEffect } from 'react'

// En produccion registra el service worker. En desarrollo lo da de baja y limpia sus caches:
// un service worker viejo en localhost sirve archivos desactualizados y rompe el hot reload.
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    if (process.env.NODE_ENV === 'production') {
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
