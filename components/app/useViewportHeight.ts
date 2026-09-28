'use client'

import { useEffect } from 'react'

// Alto realmente visible (sin el teclado) en la variable CSS --app-h, para el marco de la app.
// Android ya achica la pagina con el teclado (interactive-widget=resizes-content en app/layout.tsx), pero iPhone no:
// alli el teclado tapa la parte de abajo y Safari empuja toda la pagina hacia arriba (se van el encabezado y los
// mensajes del chat). Con el alto visible y la pagina vuelta arriba, el campo de texto queda justo sobre el teclado.
export const useViewportHeight = () => {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement

    const update = () => {
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
      // Deshace el corrimiento que hace Safari al enfocar un campo (el marco ya mide lo visible)
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--app-h')
    }
  }, [])
}
