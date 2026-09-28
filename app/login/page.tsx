'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getToken, setToken as saveToken } from '@/lib/client-auth'
import { parseInviteHash } from '@/lib/invite'
import { isStandalone } from '@/lib/pwa'
import { useAppStore } from '@/store/useAppStore'

export default function LoginPage() {
  const router = useRouter()
  const { setUser, setToken, isLoading, setLoading, error, setError } = useAppStore()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  // 'checking': todavia no sabemos si vino con enlace de invitacion; 'auto': entrando con el enlace
  const [phase, setPhase] = useState<'checking' | 'auto' | 'form'>('checking')
  // 'app': entrar con el codigo que da el navegador (para la app instalada, que no comparte la sesion en iPhone)
  const [mode, setMode] = useState<'invite' | 'app'>('invite')
  const [appCode, setAppCode] = useState('')

  const login = useCallback(
    async (loginEmail: string, loginCode: string) => {
      setError(null)
      setLoading(true)
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: loginEmail, code: loginCode }),
        })
        const data = await res.json()

        if (!res.ok) {
          setError(data.error ?? 'No se pudo iniciar sesión')
          return false
        }

        localStorage.setItem('cecify_token', data.token)
        setToken(data.token)
        setUser(data.user)
        router.push('/onboarding')
        return true
      } catch {
        setError('Sin conexión, probá de nuevo')
        return false
      } finally {
        setLoading(false)
      }
    },
    [router, setError, setLoading, setToken, setUser]
  )

  // Enlace o QR de invitacion: /login#e=email&c=codigo. El fragmento no viaja al servidor y se
  // borra de la barra apenas se lee. Si el codigo no sirve queda el formulario con los datos cargados.
  useEffect(() => {
    const timer = setTimeout(() => {
      const invite = parseInviteHash(window.location.hash)
      if (!invite) {
        // Ya tiene sesion (p. ej. abrio la app instalada en Android): directo adentro, sin pedir nada
        if (getToken()) return router.replace('/onboarding')
        if (isStandalone()) setMode('app')
        return setPhase('form')
      }

      window.history.replaceState(null, '', window.location.pathname)
      setEmail(invite.email)
      setCode(invite.code)
      setPhase('auto')
      void login(invite.email, invite.code).then((ok) => {
        if (!ok) setPhase('form')
      })
    }, 0)
    return () => clearTimeout(timer)
  }, [login, router])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void login(email, code)
  }

  const onAppCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/transfer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: appCode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'No se pudo entrar')
        return
      }
      saveToken(data.token)
      setToken(data.token)
      router.replace('/onboarding')
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5EFE0] px-6">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 text-neutral-800 shadow-sm">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="mx-auto h-20 w-auto" />
          <h1 className="mt-3 text-2xl font-semibold text-[#4A7C59]">Cecify</h1>
          <p className="mt-1 text-sm text-neutral-500">Lucas &amp; Cecilia</p>
        </div>

        {phase !== 'form' ? (
          <div role="status" className="flex flex-col items-center gap-3 py-6 text-sm text-neutral-500">
            <Loader2 className="animate-spin text-[#4A7C59]" />
            {phase === 'auto' ? 'Entrando…' : null}
          </div>
        ) : mode === 'app' ? (
          <form onSubmit={onAppCode} className="space-y-5">
            <p className="text-sm text-neutral-600">
              Si ya entraste desde el navegador: abrí tu perfil ahí, tocá <strong>Generar código para la app</strong> y escribilo acá.
            </p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Código para la app</span>
              <input
                type="text"
                required
                autoComplete="one-time-code"
                autoCapitalize="characters"
                placeholder="XXXX-XXXX"
                value={appCode}
                onChange={(e) => setAppCode(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 uppercase tracking-widest outline-none focus:border-[#4A7C59]"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-[#4A7C59] py-2.5 font-medium text-white disabled:opacity-60"
            >
              {isLoading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-[#4A7C59]"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Código de acceso</span>
              <input
                type="text"
                required
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 uppercase tracking-widest outline-none focus:border-[#4A7C59]"
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-[#4A7C59] py-2.5 font-medium text-white disabled:opacity-60"
            >
              {isLoading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}

        {phase === 'form' && (
          <button
            type="button"
            onClick={() => {
              setError(null)
              setMode(mode === 'app' ? 'invite' : 'app')
            }}
            className="block w-full text-center text-sm font-medium text-[#4A7C59] underline"
          >
            {mode === 'app' ? 'Tengo una invitación con email y código' : '¿Ya entraste desde el navegador? Usá un código de la app'}
          </button>
        )}

        {phase === 'form' && (
          <p className="text-center text-xs text-neutral-500">
            ¿Organizás la fiesta?{' '}
            <Link href="/login/admin" className="font-medium text-[#4A7C59] underline">
              Entrá con usuario y contraseña
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
