'use client'

// ¿Se esta usando la app instalada (desde la pantalla de inicio) y no el navegador?
export const isStandalone = () => {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// iPhone/iPad (incluye iPad con modo escritorio, que dice ser Mac pero tiene pantalla tactil)
export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1))
