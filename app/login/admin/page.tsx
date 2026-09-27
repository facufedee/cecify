'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import Captcha, { CAPTCHA_SITE_KEY } from '@/components/app/Captcha'
import { setToken } from '@/lib/client-auth'

const input =
  'w-full rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-[#4A7C59] focus:ring-1 focus:ring-[#4A7C59]'

// Entrada de los organizadores (usuario y contraseña). Los invitados entran por /login o con el QR de la fiesta.
export default function AdminLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaKey, setCaptchaKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, captcha }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'No se pudo entrar')
        setPassword('')
        setCaptchaKey((k) => k + 1)
        return
      }
      setToken(data.token)
      router.replace('/admin')
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0] px-3 sm:px-6">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-5 sm:p-8 text-neutral-800 shadow-sm">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="mx-auto h-16 w-auto" />
          <h1 className="mt-3 text-xl font-semibold text-[#4A7C59]">Organizadores</h1>
          <p className="mt-1 text-sm text-neutral-500">Panel de Cecify</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Usuario</span>
            <input
              className={input}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Contraseña</span>
            <input
              className={input}
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <Captcha key={captchaKey} onToken={setCaptcha} />

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password || (CAPTCHA_SITE_KEY !== '' && !captcha)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#4A7C59] py-2.5 font-medium text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />} Entrar
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500">
          ¿Sos invitado?{' '}
          <Link href="/login" className="font-medium text-[#4A7C59] underline">
            Entrá con tu código
          </Link>
        </p>
      </div>
    </main>
  )
}
