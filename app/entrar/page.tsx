'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getToken, setToken } from '@/lib/client-auth'
import { parseEventHash } from '@/lib/event'
import { NAME_MAX } from '@/lib/guests'

// Guarda la clave del QR mientras dura la pestaña: si recarga la pagina (ya sin el #) no hay que volver a escanear
const KEY_STORAGE = 'cecify_event_key'

const input =
  'w-full rounded-xl bg-[#F5EFE0] px-4 py-3 text-base text-neutral-800 outline-none ring-1 ring-transparent transition placeholder:text-neutral-500 focus:bg-white focus:ring-[#4A7C59]'

// Pantalla que abre el QR de la fiesta (/entrar#k=clave): nombre + WhatsApp y adentro.
export default function EventJoinPage() {
  const router = useRouter()
  const [key, setKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<'checking' | 'form' | 'no-key'>('checking')
  const [name, setName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Ya tiene sesion en este celular (escaneo el QR de otra mesa): directo a la app
    if (getToken()) {
      router.replace('/onboarding')
      return
    }
    const timer = setTimeout(() => {
      let k = parseEventHash(window.location.hash)
      if (k) {
        window.history.replaceState(null, '', window.location.pathname) // la clave no queda en la barra
        try {
          sessionStorage.setItem(KEY_STORAGE, k)
        } catch {}
      } else {
        try {
          k = sessionStorage.getItem(KEY_STORAGE)
        } catch {}
      }
      setKey(k)
      setPhase(k ? 'form' : 'no-key')
    }, 0)
    return () => clearTimeout(timer)
  }, [router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/event-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name, whatsapp }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'No se pudo entrar')
        return
      }
      setToken(data.token)
      try {
        sessionStorage.removeItem(KEY_STORAGE)
      } catch {}
      // El onboarding manda directo a la app a quien ya tenia perfil (recupero su cuenta)
      router.replace('/onboarding')
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-5 py-8">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-7 text-neutral-800 shadow-sm">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="mx-auto h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-semibold text-[#4A7C59]">¡Bienvenido a la fiesta!</h1>
          <p className="mt-1 text-sm text-neutral-500">Lucas &amp; Cecilia · Cecify</p>
        </div>

        {phase === 'checking' && (
          <div role="status" className="flex justify-center py-6">
            <Loader2 className="animate-spin text-[#4A7C59]" />
          </div>
        )}

        {phase === 'no-key' && (
          <div className="space-y-4 text-center text-sm text-neutral-600">
            <p>Escaneá el QR de la fiesta con la cámara del celular: está en la entrada y en cada mesa.</p>
            <p>
              ¿Tenés una invitación con código?{' '}
              <Link href="/login" className="font-medium text-[#4A7C59] underline">
                Entrá acá
              </Link>
            </p>
          </div>
        )}

        {phase === 'form' && (
          <form onSubmit={submit} className="space-y-5">
            <p className="text-center text-sm text-neutral-600">Dos datos y listo: vas a quedar adentro toda la noche.</p>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Tu nombre</span>
              <input
                className={input}
                required
                maxLength={NAME_MAX}
                autoComplete="name"
                placeholder="Cómo querés que te vean"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium">Tu WhatsApp</span>
              <input
                className={input}
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="11 5555-1234"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
              <span className="mt-1.5 block text-xs text-neutral-500">
                Es tu forma de entrar: si cambiás de celular, escaneás el QR otra vez con el mismo número. A tus matches solo se lo mostramos si lo dejás como contacto.
              </span>
            </label>

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !name.trim() || !whatsapp.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4A7C59] py-3.5 font-medium text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={18} className="animate-spin" />} Entrar
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
