'use client'

import { useEffect, useRef } from 'react'

// Captcha "no soy un robot" de Cloudflare Turnstile. Sin NEXT_PUBLIC_TURNSTILE_SITE_KEY no se muestra
// (desarrollo) y el servidor tampoco lo pide. La mayoria de las veces se resuelve solo, sin tocar nada.
export const CAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<void> | null = null
const loadScript = () =>
  (loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      loading = null
      reject(new Error('No se pudo cargar la verificación'))
    }
    document.head.appendChild(s)
  }))

// onToken(null) = vencio o hubo un error: hay que volver a verificar.
// Cambiar `resetKey` vuelve a mostrarlo (cada verificacion sirve una sola vez: despues de un intento fallido).
export default function Captcha({ onToken, resetKey = 0 }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const callback = useRef(onToken)
  useEffect(() => {
    callback.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!CAPTCHA_SITE_KEY || !box.current) return
    let id: string | null = null
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return
        id = window.turnstile.render(box.current, {
          sitekey: CAPTCHA_SITE_KEY,
          language: 'es',
          // El normal mide 300 px: en pantallas angostas se usa el compacto para que no se corte
          size: box.current.offsetWidth < 300 ? 'compact' : 'normal',
          callback: (token: string) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null),
        })
      })
      .catch(() => callback.current(null))
    return () => {
      cancelled = true
      callback.current(null)
      if (id && window.turnstile) window.turnstile.remove(id)
    }
  }, [resetKey])

  if (!CAPTCHA_SITE_KEY) return null
  return <div ref={box} className="flex min-h-[65px] w-full justify-center" />
}
