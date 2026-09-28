'use client'

import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { isIOS, isStandalone } from '@/lib/pwa'

type Prompt = Event & { prompt: () => Promise<void> }

// "Usar Cecify como app": como instalarla. Si la app instalada pide entrar (en iPhone no comparte la sesion de
// Safari), se entra con el nombre y el PIN. No se muestra dentro de la app ya instalada.
export default function InstallApp() {
  const [show, setShow] = useState(false)
  const [ios, setIos] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(!isStandalone())
      setIos(isIOS())
    }, 0)
    // Chrome en Android ofrece instalar con un boton propio
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as Prompt)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', onPrompt)
    }
  }, [])

  if (!show) return null

  return (
    <section className="mt-4 rounded-xl border border-ig-border p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold">
        <Smartphone size={18} /> Usar Cecify como app
      </h2>
      {prompt ? (
        <button
          type="button"
          onClick={() => void prompt.prompt().then(() => setPrompt(null))}
          className="mt-3 w-full rounded-lg bg-brand py-2 font-semibold text-white"
        >
          Instalar la app
        </button>
      ) : (
        <p className="mt-2 text-ig-muted">
          {ios
            ? 'En Safari tocá Compartir (el cuadrado con la flecha) y después "Agregar a inicio".'
            : 'En el menú del navegador (⋮) tocá "Instalar app" o "Agregar a la pantalla de inicio".'}
        </p>
      )}
      <p className="mt-3 text-ig-muted">Si la app te pide entrar, buscá tu nombre y poné tu PIN.</p>
    </section>
  )
}
