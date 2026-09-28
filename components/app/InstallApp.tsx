'use client'

import { useEffect, useState } from 'react'
import { Copy, Loader2, Smartphone } from 'lucide-react'
import { authFetch } from '@/lib/client-auth'
import { prettyCode } from '@/lib/format'
import { isIOS, isStandalone } from '@/lib/pwa'

type Prompt = Event & { prompt: () => Promise<void> }

// "Usar Cecify como app": como instalarla y un codigo de un solo uso para entrar en la app instalada sin volver a
// loguearse (en iPhone la app instalada no ve la sesion de Safari). No se muestra dentro de la app ya instalada.
export default function InstallApp() {
  const [show, setShow] = useState(false)
  const [ios, setIos] = useState(false)
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  const newCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch('/api/auth/transfer', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'No se pudo generar el código')
      setCode(data)
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el código')
    } finally {
      setBusy(false)
    }
  }

  const until = code ? new Date(code.expiresAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''

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

      <p className="mt-3 text-ig-muted">
        {ios ? 'En iPhone la app' : 'Si la app'} te pide entrar de nuevo, generá un código acá y escribilo en la app: entrás con esta
        misma cuenta.
      </p>

      {code ? (
        <div className="mt-3 rounded-lg bg-ig-soft p-3 text-center">
          <p className="font-mono text-2xl font-semibold tracking-widest">{prettyCode(code.code)}</p>
          <p className="mt-1 text-xs text-ig-muted">Sirve una sola vez, hasta las {until}.</p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ig-link"
            onClick={() =>
              navigator.clipboard
                ?.writeText(code.code)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            <Copy size={14} /> {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={newCode}
          disabled={busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-ig-soft py-2 font-semibold disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />} Generar código para la app
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-ig-like">
          {error}
        </p>
      )}
    </section>
  )
}
