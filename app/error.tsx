'use client'

import { useEffect } from 'react'

// Pantalla de error de la app (en vez de la pantalla por defecto de Next)
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-8 text-center text-neutral-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/logo-mark.png" alt="" className="h-16 w-auto" />
      <h1 className="mt-4 text-xl font-semibold">Algo salió mal</h1>
      <p className="mt-1 text-sm text-neutral-500">Probá de nuevo. Si sigue pasando, avisale a los novios.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-2xl bg-brand px-6 py-2.5 text-sm font-medium text-white"
      >
        Reintentar
      </button>
    </main>
  )
}
