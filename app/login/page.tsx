'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Heart, Loader2, Lock, Search } from 'lucide-react'
import { getToken, setToken } from '@/lib/client-auth'
import { NAME_MAX } from '@/lib/guests'
import { cleanPin, PIN_LENGTH } from '@/lib/pin'
import { coupleTitle, isSide, sideLabels, type CoupleNames, type Side } from '@/lib/profile-schema'
import { readWeddingCode, rememberWeddingCode } from '@/lib/wedding-client'
import { normalizeWeddingCode, parseWeddingCode } from '@/lib/wedding-code'

// returning = un organizador le reinicio el PIN: inventa otro (aunque el registro este cerrado)
type Guest = { id: string; name: string; side: string | null; claimed: boolean; returning: boolean }
// El casamiento elegido con su codigo (GET /api/weddings/by-code)
type Wedding = CoupleNames & { code: string }
type Labels = Record<Side, string>

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

// Que dice la API cuando el codigo no sirve
const codeErrorMessage = (status: number, data: { error?: string; code?: string }) => {
  if (status === 404 || data.code === 'NOT_FOUND') return 'No encontramos un casamiento con ese código. Revisalo con quien te lo pasó.'
  if (status === 400 || data.code === 'WEDDING_CODE') return 'El código tiene 6 letras y números. Revisalo y probá de nuevo.'
  return data.error ?? 'No se pudo buscar el casamiento'
}

// Unica pantalla de entrada de los invitados:
//   1. El codigo del casamiento (queda guardado en el celular; el link /c/CODIGO lo completa solo).
//   2. Buscar tu nombre en la lista y tu PIN de 4 numeros.
//      Primera vez (con el registro habilitado): te elegis e inventas tu PIN.
//      Despues: tu nombre y tu PIN, desde cualquier celular (aunque el registro este cerrado).
// Con la sesion abierta en este celular, entra directo.
export default function LoginPage() {
  const router = useRouter()
  // loading = buscando el casamiento guardado; code = pidiendo el codigo; guest = buscando el nombre
  const [phase, setPhase] = useState<'loading' | 'code' | 'guest'>('loading')
  const [wedding, setWedding] = useState<Wedding | null>(null)
  const [codeDraft, setCodeDraft] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)
  const [selected, setSelected] = useState<Guest | null>(null)

  // Busca el casamiento por codigo; si existe, lo guarda en el celular y pasa a buscar el nombre
  const lookup = async (code: string) => {
    try {
      const res = await fetch(`/api/weddings/by-code?code=${encodeURIComponent(code)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCodeDraft(code)
        setCodeError(codeErrorMessage(res.status, data))
        setPhase('code')
        return
      }
      rememberWeddingCode(code)
      setWedding({ code, partnerA: data.partnerA, partnerB: data.partnerB })
      setRegistrationOpen(data.registrationOpen === true)
      setSelected(null)
      setCodeError(null)
      setPhase('guest')
    } catch {
      setCodeDraft(code)
      setCodeError('Sin conexión, probá de nuevo')
      setPhase('code')
    }
  }

  useEffect(() => {
    if (getToken()) {
      router.replace('/onboarding') // el onboarding manda directo a la app a quien ya tiene perfil
      return
    }
    const timer = setTimeout(() => {
      const stored = readWeddingCode()
      if (stored) void lookup(stored)
      else setPhase('code')
    }, 0)
    return () => clearTimeout(timer)
  }, [router])

  const enter = (token: string) => {
    setToken(token)
    router.replace('/onboarding')
  }

  const changeCode = () => {
    setCodeDraft(wedding?.code ?? '')
    setCodeError(null)
    setSelected(null)
    setPhase('code')
  }

  const labels = sideLabels(wedding)
  const title = coupleTitle(wedding)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-3 py-8 sm:px-5">
      <div className="w-full max-w-sm space-y-6 rounded-3xl bg-white p-5 text-neutral-800 shadow-sm sm:p-7">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="mx-auto h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-semibold text-[#4A7C59]">Lovify</h1>
          {phase === 'guest' && title && (
            <p className="mt-1 text-sm text-neutral-500">
              Casamiento de <span className="font-medium text-neutral-700">{title}</span>
              {' · '}
              <button type="button" onClick={changeCode} className="font-medium text-[#4A7C59] underline">
                Cambiar código
              </button>
            </p>
          )}
          <p className="mt-3 text-sm italic text-neutral-600">
            En esta fiesta donde se celebra el amor, encontrá el tuyo 😃
          </p>
        </div>

        {phase === 'loading' ? (
          <div role="status" className="flex justify-center py-6">
            <Loader2 className="animate-spin text-[#4A7C59]" />
          </div>
        ) : phase === 'code' || !wedding ? (
          <CodeStep initial={codeDraft} error={codeError} onSubmit={lookup} />
        ) : selected ? (
          selected.claimed ? (
            <EnterPin guest={selected} code={wedding.code} labels={labels} onBack={() => setSelected(null)} onEnter={enter} />
          ) : (
            <CreatePin
              guest={selected}
              code={wedding.code}
              labels={labels}
              registrationOpen={registrationOpen}
              onBack={() => setSelected(null)}
              onEnter={enter}
            />
          )
        ) : (
          <SearchName code={wedding.code} labels={labels} registrationOpen={registrationOpen} onPick={setSelected} />
        )}

        <div className="space-y-1.5 text-center text-xs text-neutral-500">
          <p>
            <Link href="/crear" className="inline-flex items-center gap-1 underline">
              <Heart size={12} aria-hidden /> ¿Se casan? Creá su casamiento
            </Link>
          </p>
          <p>
            <Link href="/login/admin" className="underline">
              Entrada de organizadores
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}

// Paso 1: el codigo del casamiento (6 letras y numeros; da igual mayusculas, espacios o guiones)
function CodeStep({ initial, error, onSubmit }: { initial: string; error: string | null; onSubmit: (code: string) => Promise<void> }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const code = parseWeddingCode(value)
  const typed = normalizeWeddingCode(value)
  const malformed = typed.length >= 6 && !code

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code) return
    setBusy(true)
    try {
      await onSubmit(code)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1.5 block text-center text-neutral-600">Escribí el código del casamiento</span>
        <input
          className={`${input} text-center text-2xl font-semibold uppercase tracking-[0.3em]`}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          placeholder="ABC234"
          aria-label="Código del casamiento"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
        />
        <span className="mt-1.5 block text-center text-xs text-neutral-500">
          Te lo pasaron los novios con la invitación o está en el QR de la fiesta.
        </span>
      </label>
      {malformed && <p className="text-center text-sm text-red-600">El código tiene 6 letras y números (sin O, I, L, 0 ni 1)</p>}
      {error && !malformed && (
        <p role="alert" className="text-center text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !code} className={primary}>
        {busy && <Loader2 size={18} className="animate-spin" />} Continuar
      </button>
    </form>
  )
}

function SearchName({
  code,
  labels,
  registrationOpen,
  onPick,
}: {
  code: string
  labels: Labels
  registrationOpen: boolean | null
  onPick: (g: Guest) => void
}) {
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
        const { ok, data } = await post('/api/auth/guest/search', { q, code })
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
  }, [query, code])

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
                    {isSide(g.side) && <span className="block text-xs text-neutral-500">{labels[g.side]}</span>}
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

function Header({ guest, labels, onBack }: { guest: Guest; labels: Labels; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#F5EFE0] p-3">
      <button type="button" onClick={onBack} aria-label="Elegir otro nombre" className="rounded-lg p-1.5 text-neutral-600 hover:bg-white">
        <ArrowLeft size={20} />
      </button>
      <div className="min-w-0">
        <p className="truncate text-lg font-semibold">{guest.name}</p>
        {isSide(guest.side) && <p className="text-xs text-neutral-500">{labels[guest.side]}</p>}
      </div>
    </div>
  )
}

// Ya registrado: su PIN
function EnterPin({
  guest,
  code,
  labels,
  onBack,
  onEnter,
}: {
  guest: Guest
  code: string
  labels: Labels
  onBack: () => void
  onEnter: (token: string) => void
}) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { ok, data } = await post('/api/auth/guest/login', { guestId: guest.id, pin, code })
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
      <Header guest={guest} labels={labels} onBack={onBack} />
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
      <p className="text-center text-xs text-neutral-500">¿No sos vos o te olvidaste el PIN? Pedile a quien organiza que te blanquee la contraseña.</p>
    </form>
  )
}

// Primera vez: elegirse e inventar el PIN (solo con el registro habilitado)
function CreatePin({
  guest,
  code,
  labels,
  registrationOpen,
  onBack,
  onEnter,
}: {
  guest: Guest
  code: string
  labels: Labels
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
        <Header guest={guest} labels={labels} onBack={onBack} />
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
      const { ok, data } = await post('/api/auth/guest/register', { guestId: guest.id, pin, code })
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
      <Header guest={guest} labels={labels} onBack={onBack} />
      <p className="text-center text-sm text-neutral-600">
        {guest.returning
          ? 'Te blanquearon la contraseña: creá un PIN nuevo de 4 números.'
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
