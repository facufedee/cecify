'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'

export default function LoginPage() {
  const router = useRouter()
  const { setUser, setToken, isLoading, setLoading, error, setError } = useAppStore()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'No se pudo iniciar sesión')
        return
      }

      localStorage.setItem('cecify_token', data.token)
      setToken(data.token)
      setUser(data.user)
      router.push('/onboarding')
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5EFE0] px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 text-neutral-800 shadow-sm"
      >
        <div className="text-center">
          <h1 className="text-3xl font-semibold text-[#4A7C59]">Cecify</h1>
          <p className="mt-1 text-sm text-neutral-500">Lucas &amp; Cecilia</p>
        </div>

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
    </main>
  )
}
