'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Lock, Search } from 'lucide-react'
import { getToken, setToken } from '@/lib/client-auth'
import { NAME_MAX } from '@/lib/guests'
import { cleanPin, PIN_LENGTH } from '@/lib/pin'
import { isSide, SIDE_LABELS } from '@/lib/profile-schema'

// returning = un organizador le reinicio el PIN: inventa otro (aunque el registro este cerrado)
type Guest = { id: string; name: string; side: string | null; claimed: boolean; returning: boolean }

const input =
  'w-full rounded-xl bg-[#F5EFE0] px-4 py-3 text-base text-neutral-800 outline-none ring-1 ring-transparent transition placeholder:text-neutral-500 focus:bg-white focus:ring-[#4A7C59]'
const pinInput = `${input} text-center text-2xl tracking-[0.6em]`
const primary =
  'flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4A7C59] py-3.5 font-medium text-white disabled:opacity-50'
const link = 'block w-full text-center text-sm font-medium text-[#4A7C59] underline'

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, data: await res.json().catch(() => ({})) }
}

// Unica pantalla de entrada de los invitados: buscar tu nombre en la lista y tu PIN de 4 numeros.
//   Primera vez (con el registro habilitado): te elegis e inventas tu PIN.
//   Despues: tu nombre y tu PIN, desde cualquier celular (aunque el registro este cerrado).
// Con la sesion abierta en este celular, entra directo.
export default function LoginPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)
  const [selected, setSelected] = useState<Guest | null>(null)

  useEffect(() => {
    if (getToken()) {
      router.replace('/onboarding') // el onboarding manda directo a la app a quien ya tiene perfil
      return
    }
    const timer = setTimeout(() => setReady(true), 0)
    post('/api/auth/guest/search', {})
      .then(({ ok, data }) => ok && setRegistrationOpen(data.registrationOpen === true))
      .catch(() => {})
    return () => clearTimeout(timer)
  }, [router])

  const enter = (token: string) => {
    setToken(token)
    router.replace('/onboarding')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-3 py-8 sm:px-5">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-5 text-neutral-800 shadow-sm sm:p-7">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="mx-auto h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-semibold text-[#4A7C59]">Cecify</h1>
          <p className="mt-1 text-sm text-neutral-500">Lucas &amp; Cecilia</p>
        </div>

        {!ready ? (
          <div role="status" className="flex justify-center py-6">
            <Loader2 className="animate-spin text-[#4A7C59]" />
          </div>
        ) : selected ? (
          selected.claimed ? (
            <EnterPin guest={selected} onBack={() => setSelected(null)} onEnter={enter} />
          ) : (
            <CreatePin guest={selected} registrationOpen={registrationOpen} onBack={() => setSelected(null)} onEnter={enter} />
          )
        ) : (
          <SearchName registrationOpen={registrationOpen} onPick={setSelected} />
        )}

        <p className="text-center text-xs text-neutral-500">
          <Link href="/login/admin" className="underline">
            Entrada de organizadores
          </Link>
        </p>
      </div>
    </main>
  )
}

function SearchName({ registrationOpen, onPick }: { registrationOpen: boolean | null; onPick: (g: Guest) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Guest[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastQuery = useRef('')

  // Busca mientras escribe (con una pausa corta para no mandar un pedido por letra)
  useEffect(() => {
    const q = query.trim()
    lastQuery.current = q
    if (q.length < 2) {
      const clear = setTimeout(() => setResults(null), 0)
      return () => clearTimeout(clear)
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const { ok, data } = await post('/api/auth/guest/search', { q })
        if (lastQuery.current !== q) return // llego tarde: ya escribio otra cosa
        if (!ok) throw new Error(data.error)
        setError(null)
        setResults(data.guests ?? [])
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : 'Sin conexión, probá de nuevo')
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const q = query.trim()

  return (
    <div className="space-y-4">
      {registrationOpen === false && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
          El registro de invitados nuevos está momentáneamente inhabilitado. Si ya entraste, buscá tu nombre y poné tu PIN.
        </p>
      )}
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
            onChange={(e) => setQuery(e.target.value)}
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
          <p className="text-center text-sm text-neutral-600">
            No te encontramos. Probá con tu apellido; si igual no aparecés, avisale a quien organiza.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Resultados">
            {results.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onPick(g)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3 text-left transition hover:border-[#4A7C59]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{g.name}</span>
                    {isSide(g.side) && <span className="block text-xs text-neutral-500">{SIDE_LABELS[g.side]}</span>}
                  </span>
                  {g.claimed && <Lock size={16} className="shrink-0 text-neutral-500" aria-label="Ya registrado: entra con PIN" />}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

function Header({ guest, onBack }: { guest: Guest; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#F5EFE0] p-3">
      <button type="button" onClick={onBack} aria-label="Elegir otro nombre" className="rounded-lg p-1.5 text-neutral-600 hover:bg-white">
        <ArrowLeft size={20} />
      </button>
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold">{guest.name}</p>
        {isSide(guest.side) && <p className="text-xs text-neutral-500">{SIDE_LABELS[guest.side]}</p>}
      </div>
    </div>
  )
}

// Ya registrado: su PIN
function EnterPin({ guest, onBack, onEnter }: { guest: Guest; onBack: () => void; onEnter: (token: string) => void }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { ok, data } = await post('/api/auth/guest/login', { guestId: guest.id, pin })
      if (ok) return onEnter(data.token)
      setError(data.error ?? 'No se pudo entrar')
      setPin('')
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Header guest={guest} onBack={onBack} />
      <label className="block text-sm">
        <span className="mb-1.5 block text-center font-medium">Tu PIN</span>
        <input
          className={pinInput}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={(e) => setPin(cleanPin(e.target.value))}
          aria-label="Tu PIN de 4 números"
        />
      </label>
      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || pin.length !== PIN_LENGTH} className={primary}>
        {busy && <Loader2 size={18} className="animate-spin" />} Entrar
      </button>
      <p className="text-center text-xs text-neutral-500">¿No sos vos o te olvidaste el PIN? Pedile a quien organiza que lo reinicie.</p>
    </form>
  )
}

// Primera vez: elegirse e inventar el PIN (solo con el registro habilitado)
function CreatePin({
  guest,
  registrationOpen,
  onBack,
  onEnter,
}: {
  guest: Guest
  registrationOpen: boolean | null
  onBack: () => void
  onEnter: (token: string) => void
}) {
  const [pin, setPin] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El registro cerrado es solo para gente nueva: a quien le reiniciaron el PIN lo deja inventar otro
  const [closed, setClosed] = useState(registrationOpen === false && !guest.returning)

  if (closed) {
    return (
      <div className="space-y-4">
        <Header guest={guest} onBack={onBack} />
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
          <strong>Registro momentáneamente inhabilitado.</strong> Se abre cuando empiece la fiesta: probá de nuevo más tarde.
        </p>
        <button type="button" onClick={onBack} className={link}>
          Volver
        </button>
      </div>
    )
  }

  const mismatch = repeat.length === PIN_LENGTH && pin !== repeat

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { ok, data } = await post('/api/auth/guest/register', { guestId: guest.id, pin })
      if (ok) return onEnter(data.token)
      if (data.code === 'CLOSED') return setClosed(true)
      setError(data.error ?? 'No se pudo entrar')
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Header guest={guest} onBack={onBack} />
      <p className="text-center text-sm text-neutral-600">
        {guest.returning
          ? 'Te reiniciaron el PIN: inventá uno nuevo de 4 números.'
          : 'Es tu primera vez: inventá un PIN de 4 números. Lo vas a usar si entrás desde otro celular.'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1.5 block text-center font-medium">PIN</span>
          <input
            className={pinInput}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            autoFocus
            maxLength={PIN_LENGTH}
            value={pin}
            onChange={(e) => setPin(cleanPin(e.target.value))}
            aria-label="Inventá un PIN de 4 números"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-center font-medium">Repetilo</span>
          <input
            className={pinInput}
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={PIN_LENGTH}
            value={repeat}
            onChange={(e) => setRepeat(cleanPin(e.target.value))}
            aria-label="Repetí el PIN"
          />
        </label>
      </div>
      {mismatch && <p className="text-center text-sm text-red-600">Los PIN no coinciden</p>}
      {error && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || pin.length !== PIN_LENGTH || pin !== repeat} className={primary}>
        {busy && <Loader2 size={18} className="animate-spin" />} Soy yo — Entrar
      </button>
      <p className="text-center text-xs text-neutral-500">Elegí solo tu nombre: si elegís el de otra persona, ella no va a poder entrar.</p>
    </form>
  )
}
