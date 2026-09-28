'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import Captcha, { CAPTCHA_SITE_KEY } from '@/components/app/Captcha'
import { getToken, setToken } from '@/lib/client-auth'
import { parseEventHash } from '@/lib/event'
import { NAME_MAX } from '@/lib/guests'

// Guarda la clave del QR mientras dura la pestaña: si recarga la pagina (ya sin el #) no hay que volver a escanear
const KEY_STORAGE = 'cecify_event_key'

const input =
  'w-full rounded-xl bg-[#F5EFE0] px-4 py-3 text-base text-neutral-800 outline-none ring-1 ring-transparent transition placeholder:text-neutral-500 focus:bg-white focus:ring-[#4A7C59]'

// Pantalla que abre el QR de la fiesta (/entrar#k=clave): nombre + WhatsApp o Instagram, captcha y adentro.
export default function EventJoinPage() {
  const router = useRouter()
  const [key, setKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<'checking' | 'form' | 'no-key'>('checking')
  const [name, setName] = useState('')
  const [via, setVia] = useState<'whatsapp' | 'instagram'>('whatsapp')
  const [contact, setContact] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
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
        body: JSON.stringify({ key, name, [via]: contact, captcha }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'No se pudo entrar')
        // Cada verificacion sirve una vez: para reintentar hay que hacer otra
        setCaptchaKey((k) => k + 1)
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
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-3 py-8 sm:px-5">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-5 sm:p-7 text-neutral-800 shadow-sm">
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
            <div className="text-sm">
              <span className="mb-1.5 block font-medium">Entrá con</span>
              <div role="radiogroup" aria-label="Entrá con" className="mb-2 grid grid-cols-2 gap-2">
                {(['whatsapp', 'instagram'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={via === v}
                    onClick={() => {
                      setVia(v)
                      setContact('')
                    }}
                    className={`rounded-xl border py-2 text-sm font-medium transition ${
                      via === v ? 'border-[#4A7C59] bg-[#4A7C59] text-white' : 'border-neutral-200 text-neutral-600'
                    }`}
                  >
                    {v === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                  </button>
                ))}
              </div>
              <input
                className={input}
                required
                aria-label={via === 'whatsapp' ? 'Tu WhatsApp' : 'Tu usuario de Instagram'}
                {...(via === 'whatsapp'
                  ? { type: 'tel', inputMode: 'tel' as const, autoComplete: 'tel', placeholder: '11 5555-1234' }
                  : { type: 'text', autoCapitalize: 'none', autoComplete: 'off', placeholder: '@tu.usuario' })}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
              <span className="mt-1.5 block text-xs text-neutral-500">
                Es tu forma de entrar: si cambiás de celular, escaneás el QR otra vez con el mismo dato. A tus matches solo se
                lo mostramos si lo dejás como contacto.
              </span>
            </div>

            <Captcha key={captchaKey} onToken={setCaptcha} />

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !name.trim() || !contact.trim() || (CAPTCHA_SITE_KEY !== '' && !captcha)}
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
