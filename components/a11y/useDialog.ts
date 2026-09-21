'use client'

import { useEffect, useRef } from 'react'

// Comportamiento accesible de un dialogo modal (hoja de comentarios, menu, reporte, etc.):
//  - al abrir, el foco pasa al dialogo (o al elemento con data-autofocus) para que el lector de pantalla lo anuncie
//  - el Tab queda atrapado adentro: no se puede "salir" hacia la pagina de fondo
//  - Escape lo cierra (solo el de mas arriba si hay varios apilados)
//  - al cerrar, el foco vuelve al elemento que lo abrio
// Uso: const ref = useDialog<HTMLDivElement>(onClose) y en el elemento: ref={ref} role="dialog" aria-modal="true" tabIndex={-1}
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

const isVisible = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'

// Dialogos abiertos, el ultimo es el que esta arriba
const openDialogs: symbol[] = []

export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void, opts: { closeOnEscape?: boolean } = {}) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  const escapeRef = useRef(opts.closeOnEscape ?? true)

  useEffect(() => {
    closeRef.current = onClose
    escapeRef.current = opts.closeOnEscape ?? true
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const id = Symbol('dialog')
    openDialogs.push(id)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible)
    ;(el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (openDialogs.at(-1) !== id) return

      if (e.key === 'Escape' && escapeRef.current) {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        el.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === el || !el.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const at = openDialogs.indexOf(id)
      if (at >= 0) openDialogs.splice(at, 1)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return ref
}
