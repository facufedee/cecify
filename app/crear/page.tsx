'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import Captcha, { CAPTCHA_SITE_KEY } from '@/components/app/Captcha'
import ShareCode from '@/components/wedding/ShareCode'
import { setToken } from '@/lib/client-auth'
import { passwordProblem, PASSWORD_MIN, USERNAME_RE } from '@/lib/password-rules'
import { rememberWeddingCode } from '@/lib/wedding-client'
import { PARTNER_NAME_MAX, PARTNER_NAMES_ERROR, parsePartnerNames, USERNAME_ERROR } from '@/lib/wedding-code'

const input =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-[#4A7C59] focus:ring-1 focus:ring-[#4A7C59]'

// Que paso al crear: cada codigo de la API con un mensaje claro
const failure = (status: number, data: { error?: string; code?: string }) => {
  if (data.code === 'SIGNUP_DISABLED') return 'Todavía no se pueden crear casamientos desde acá. Muy pronto vas a poder hacerlo.'
  if (data.code === 'USERNAME_TAKEN') return 'Ese usuario ya existe: elegí otro.'
  if (status === 429) return data.error ?? 'Demasiados intentos, esperá unos minutos'
  return data.error ?? 'No se pudo crear el casamiento'
}

// Una pareja crea su casamiento: los nombres de los dos y la cuenta para entrar al panel (usuario y contraseña).
// Recibe el codigo y el link para compartir con los invitados, con la sesion de organizador ya iniciada.
export default function CreateWeddingPage() {
  const [partnerA, setPartnerA] = useState('')
  const [partnerB, setPartnerB] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  const names = parsePartnerNames({ partnerA, partnerB })
  const user = username.trim().toLowerCase()
  const badUser = user !== '' && !USERNAME_RE.test(user)
  const badPassword = password !== '' ? passwordProblem(password) : null
  const mismatch = repeat !== '' && repeat !== password
  const ready = names && USERNAME_RE.test(user) && !passwordProblem(password) && password === repeat

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/weddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...names, username: user, password, captcha }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.code === 'SIGNUP_DISABLED') setDisabled(true)
        setError(failure(res.status, data))
        setCaptchaKey((k) => k + 1) // cada verificacion sirve una sola vez
        return
      }
      setToken(data.token)
      rememberWeddingCode(data.code)
      setCode(data.code)
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-3 py-8 sm:px-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-5 text-neutral-800 shadow-sm sm:p-8">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="mx-auto h-16 w-auto" />
          <h1 className="mt-3 text-xl font-semibold text-[#4A7C59]">{code ? '¡Listo, ya tienen su casamiento!' : 'Creá su casamiento'}</h1>
          {!code && (
            <p className="mt-1 text-sm text-neutral-500">
              Cargan la lista de invitados, comparten el código y cada invitado entra con su nombre.
            </p>
          )}
        </div>

        {code ? (
          <div className="space-y-5">
            <ShareCode code={code} />
            <p className="text-sm text-neutral-600">
              Para volver al panel entrá como organizador con el usuario <strong>{user}</strong> y tu contraseña.
            </p>
            <Link
              href="/admin/guests"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4A7C59] py-2.5 font-medium text-white"
            >
              Cargar la lista de invitados <ArrowRight size={16} />
            </Link>
          </div>
        ) : disabled ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
              <strong>Todavía no se pueden crear casamientos.</strong> Muy pronto vas a poder hacerlo desde acá.
            </p>
            <Link href="/login" className="block text-center text-sm font-medium text-[#4A7C59] underline">
              Volver a la entrada
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">Los novios</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Nombre de uno</span>
                  <input
                    className={input}
                    required
                    maxLength={PARTNER_NAME_MAX}
                    autoComplete="off"
                    placeholder="Ej.: Ana"
                    value={partnerA}
                    onChange={(e) => setPartnerA(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Nombre del otro</span>
                  <input
                    className={input}
                    required
                    maxLength={PARTNER_NAME_MAX}
                    autoComplete="off"
                    placeholder="Ej.: Bruno"
                    value={partnerB}
                    onChange={(e) => setPartnerB(e.target.value)}
                  />
                </label>
              </div>
              {(partnerA !== '' || partnerB !== '') && !names && <p className="text-xs text-red-600">{PARTNER_NAMES_ERROR}</p>}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-sm font-semibold">Su cuenta para el panel</legend>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Usuario</span>
                <input
                  className={input}
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={30}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                {badUser && <span className="mt-1 block text-xs text-red-600">{USERNAME_ERROR}</span>}
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Contraseña</span>
                <input
                  className={input}
                  required
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span className={`mt-1 block text-xs ${badPassword ? 'text-red-600' : 'text-neutral-500'}`}>
                  {badPassword ?? `Al menos ${PASSWORD_MIN} caracteres. Mejor una frase larga que una palabra corta.`}
                </span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Repetí la contraseña</span>
                <input
                  className={input}
                  required
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
                {mismatch && <span className="mt-1 block text-xs text-red-600">Las contraseñas no coinciden</span>}
              </label>
            </fieldset>

            <Captcha key={captchaKey} onToken={setCaptcha} />

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !ready || (CAPTCHA_SITE_KEY !== '' && !captcha)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4A7C59] py-2.5 font-medium text-white disabled:opacity-60"
            >
              {busy && <Loader2 size={16} className="animate-spin" />} Crear casamiento
            </button>
          </form>
        )}

        {!code && (
          <p className="text-center text-xs text-neutral-500">
            ¿Sos invitado?{' '}
            <Link href="/login" className="font-medium text-[#4A7C59] underline">
              Entrá con el código
            </Link>
            {' · '}
            <Link href="/login/admin" className="underline">
              Ya tengo cuenta
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
