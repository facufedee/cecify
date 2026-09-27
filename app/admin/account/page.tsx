'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { btn, Card, ErrorNote, inputClass, Spinner, useToast } from '@/components/admin/ui'
import { adminJson, errorMessage } from '@/lib/admin-client'
import { setToken } from '@/lib/client-auth'
import { PASSWORD_MIN } from '@/lib/password-rules'

type Account = { username: string | null; changedAt?: string }

// Mi cuenta: cambiar la contraseña (solo las cuentas de organizador con usuario y contraseña)
export default function AdminAccountPage() {
  const { show, toast } = useToast()
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    adminJson<Account>('/api/admin/password')
      .then(setAccount)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const mismatch = repeat !== '' && next !== repeat
  const tooShort = next !== '' && next.length < PASSWORD_MIN

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await adminJson<{ token: string }>('/api/admin/password', { method: 'POST', json: { current, next } })
      setToken(r.token) // las otras sesiones se cerraron; esta sigue con el token nuevo
      setCurrent('')
      setNext('')
      setRepeat('')
      setAccount((a) => (a ? { ...a, changedAt: new Date().toISOString() } : a))
      show('Contraseña cambiada. Se cerraron tus otras sesiones.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!account) return <div className="flex justify-center py-16">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>

  if (!account.username) {
    return (
      <Card className="p-4 text-sm text-neutral-600">
        Tu cuenta entra con un código de invitado o con el QR de la fiesta, así que no tiene contraseña.
      </Card>
    )
  }

  return (
    <div className="max-w-md space-y-4">
      <Card className="space-y-1 p-4 text-sm">
        <p>
          Usuario: <span className="font-semibold">{account.username}</span>
        </p>
        {account.changedAt && (
          <p className="text-neutral-500">
            Contraseña cambiada por última vez el{' '}
            {new Date(account.changedAt).toLocaleString('es-AR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-base font-semibold">Cambiar contraseña</h2>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Contraseña actual</span>
            <input
              type="password"
              autoComplete="current-password"
              className={inputClass}
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Contraseña nueva</span>
            <input
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <span className={`mt-1 block text-xs ${tooShort ? 'text-red-600' : 'text-neutral-500'}`}>
              Al menos {PASSWORD_MIN} caracteres. Mejor una frase larga que una palabra corta.
            </span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Repetí la contraseña nueva</span>
            <input
              type="password"
              autoComplete="new-password"
              className={inputClass}
              required
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            />
            {mismatch && <span className="mt-1 block text-xs text-red-600">No coinciden</span>}
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <button type="submit" className={btn.primary} disabled={busy || !current || tooShort || !next || next !== repeat}>
            {busy && <Loader2 size={16} className="animate-spin" />} Cambiar contraseña
          </button>
          <p className="text-xs text-neutral-500">Al cambiarla se cierran tus sesiones en los otros dispositivos.</p>
        </form>
      </Card>
      {toast}
    </div>
  )
}
