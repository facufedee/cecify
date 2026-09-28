'use client'

import { useEffect } from 'react'

// En dispositivos moviles (iOS / Android) evita que gestos como pellizcar (pinch-to-zoom)
// o doble toque amplien la pantalla, manteniendo la experiencia fija de aplicacion nativa.
export default function TouchLock() {
  useEffect(() => {
    const prevent = (e: Event) => {
      e.preventDefault()
    }

    // iOS Safari dispara gesturestart/change al detectar dos o mas dedos para hacer zoom
    document.addEventListener('gesturestart', prevent)
    document.addEventListener('gesturechange', prevent)
    document.addEventListener('gestureend', prevent)

    return () => {
      document.removeEventListener('gesturestart', prevent)
      document.removeEventListener('gesturechange', prevent)
      document.removeEventListener('gestureend', prevent)
    }
  }, [])

  return null
}
