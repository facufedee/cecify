'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Search } from 'lucide-react'
import Captcha, { CAPTCHA_SITE_KEY } from '@/components/app/Captcha'
import { getToken, setToken } from '@/lib/client-auth'
import { parseEventHash } from '@/lib/event'
import { NAME_MAX } from '@/lib/guests'
import { isSide, SIDE_LABELS } from '@/lib/profile-schema'

// Guarda la clave del QR mientras dura la pestaña: si recarga la pagina (ya sin el #) no hay que volver a escanear
const KEY_STORAGE = 'cecify_event_key'

const input =
  'w-full rounded-xl bg-[#F5EFE0] px-4 py-3 text-base text-neutral-800 outline-none ring-1 ring-transparent transition placeholder:text-neutral-500 focus:bg-white focus:ring-[#4A7C59]'
const primary =
  'flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4A7C59] py-3.5 font-medium text-white disabled:opacity-50'

type ListGuest = { id: string; name: string; side: string | null; taken: boolean }

// Ya con sesion: al onboarding, que manda directo a la app a quien ya tenia perfil
const enter = (token: string, router: ReturnType<typeof useRouter>) => {
  setToken(token)
  try {
    sessionStorage.removeItem(KEY_STORAGE)
  } catch {}
  router.replace('/onboarding')
}

// Pantalla que abre el QR de la fiesta (/entrar#k=clave). Lo principal: buscar tu nombre en la lista y elegirte.
// Para quien no esta en la lista (un +1, un error): nombre + WhatsApp o Instagram.
export default function EventJoinPage() {
  const router = useRouter()
  const [key, setKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<'checking' | 'list' | 'free' | 'no-key'>('checking')

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
      setPhase(k ? 'list' : 'no-key')
    }, 0)
    return () => clearTimeout(timer)
  }, [router])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-3 py-8 sm:px-5">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-5 text-neutral-800 shadow-sm sm:p-7">
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

        {phase === 'list' && key && <PickFromList eventKey={key} onNotInList={() => setPhase('free')} />}
        {phase === 'free' && key && <FreeJoin eventKey={key} onBack={() => setPhase('list')} />}
      </div>
    </main>
  )
}

// Buscar el nombre (2+ letras) y elegirse. Un nombre que ya entro no se puede elegir.
function PickFromList({ eventKey, onNotInList }: { eventKey: string; onNotInList: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ListGuest[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<ListGuest | null>(null)
  const [takenHint, setTakenHint] = useState<string | null>(null)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastQuery = useRef('')

  // Busca mientras escribe (con una pausa corta para no mandar un pedido por letra)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      lastQuery.current = q
      const clear = setTimeout(() => setResults(null), 0)
      return () => clearTimeout(clear)
    }
    const timer = setTimeout(async () => {
      lastQuery.current = q
      setSearching(true)
      try {
        const res = await fetch('/api/auth/guest-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: eventKey, q }),
        })
        const data = await res.json().catch(() => ({}))
        if (lastQuery.current !== q) return // llego tarde: ya escribio otra cosa
        if (!res.ok) {
          setError(data.error ?? 'No se pudo buscar')
          setResults([])
          return
        }
        setError(null)
        setResults(data.guests ?? [])
      } catch {
        setError('Sin conexión, probá de nuevo')
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, eventKey])

  const claim = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/guest-list/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: eventKey, guestId: selected.id, captcha }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'No se pudo entrar')
        setCaptchaKey((k) => k + 1) // cada verificacion sirve una vez
        if (data.code === 'TAKEN') {
          setResults((r) => r?.map((g) => (g.id === selected.id ? { ...g, taken: true } : g)) ?? r)
          setSelected(null)
        }
        return
      }
      enter(data.token, router)
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  if (selected) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl bg-[#F5EFE0] p-4 text-center">
          <p className="text-sm text-neutral-600">¿Sos vos?</p>
          <p className="mt-1 text-xl font-semibold">{selected.name}</p>
          {isSide(selected.side) && <p className="mt-0.5 text-xs text-neutral-500">{SIDE_LABELS[selected.side]}</p>}
        </div>
        <p className="text-center text-xs text-neutral-500">
          Tu nombre queda asociado a este celular. Elegí solo el tuyo: si elegís el de otra persona, ella no va a poder entrar.
        </p>

        <Captcha key={captchaKey} onToken={setCaptcha} />

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button type="button" onClick={claim} disabled={busy || (CAPTCHA_SITE_KEY !== '' && !captcha)} className={primary}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Sí, soy yo — Entrar
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(null)
            setError(null)
          }}
          className="block w-full text-center text-sm font-medium text-[#4A7C59] underline"
        >
          No, volver a buscar
        </button>
      </div>
    )
  }

  const q = query.trim()

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1.5 block text-center text-neutral-600">Buscá tu nombre en la lista de invitados</span>
        <span className="relative block">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className={`${input} pl-10`}
            type="search"
            autoFocus
            autoComplete="off"
            maxLength={NAME_MAX}
            placeholder="Tu nombre o apellido"
            aria-label="Tu nombre o apellido"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setTakenHint(null)
            }}
          />
          {searching && <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-neutral-500" />}
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {q.length < 2 && <p className="text-center text-xs text-neutral-500">Escribí al menos 2 letras.</p>}

      {results && q.length >= 2 && (
        results.length === 0 ? (
          !error && <p className="text-center text-sm text-neutral-600">No te encontramos. Probá con tu apellido o con cómo te dicen.</p>
        ) : (
          <ul className="space-y-2" aria-label="Resultados">
            {results.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    if (g.taken) setTakenHint(g.id)
                    else setSelected(g)
                  }}
                  aria-disabled={g.taken}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    g.taken ? 'border-neutral-200 bg-neutral-50 text-neutral-500' : 'border-neutral-200 hover:border-[#4A7C59]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{g.name}</span>
                    {isSide(g.side) && <span className="block text-xs text-neutral-500">{SIDE_LABELS[g.side]}</span>}
                  </span>
                  {g.taken && <span className="shrink-0 text-xs">Ya entró</span>}
                </button>
                {takenHint === g.id && (
                  <p className="mt-1.5 px-1 text-xs text-neutral-600">
                    Alguien ya entró con este nombre. Si sos vos desde otro celular: en el otro, andá a tu perfil y tocá
                    «Generar código para la app», o pedile a un organizador que libere tu nombre.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      <button type="button" onClick={onNotInList} className="block w-full pt-2 text-center text-sm font-medium text-[#4A7C59] underline">
        No estoy en la lista
      </button>
    </div>
  )
}

// Para quien no esta en la lista: nombre + WhatsApp o Instagram (el dato identifica la cuenta)
function FreeJoin({ eventKey, onBack }: { eventKey: string; onBack: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [via, setVia] = useState<'whatsapp' | 'instagram'>('whatsapp')
  const [contact, setContact] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/event-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: eventKey, name, [via]: contact, captcha }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'No se pudo entrar')
        setCaptchaKey((k) => k + 1) // cada verificacion sirve una vez
        return
      }
      enter(data.token, router)
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <p className="text-center text-sm text-neutral-600">¿No aparecés en la lista? Dos datos y listo.</p>
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
          Es tu forma de entrar: si cambiás de celular, escaneás el QR otra vez con el mismo dato. A tus matches solo se lo
          mostramos si lo dejás como contacto.
        </span>
      </div>

      <Captcha key={captchaKey} onToken={setCaptcha} />

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy || !name.trim() || !contact.trim() || (CAPTCHA_SITE_KEY !== '' && !captcha)} className={primary}>
        {busy && <Loader2 size={18} className="animate-spin" />} Entrar
      </button>
      <button type="button" onClick={onBack} className="block w-full text-center text-sm font-medium text-[#4A7C59] underline">
        Volver a buscar en la lista
      </button>
    </form>
  )
}
