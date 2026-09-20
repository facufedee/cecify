'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import StoryRing from '@/components/wall/StoryRing'
import { authFetch } from '@/lib/client-auth'
import type { BlockedUser } from '@/lib/db'

export default function BlockedPage() {
  const router = useRouter()
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    authFetch('/api/blocks')
      .then(async (res) => {
        if (!res.ok) throw new Error()
        if (!cancelled) setBlocked((await res.json()).blocked)
      })
      .catch(() => !cancelled && setError('No se pudo cargar la lista'))
    return () => {
      cancelled = true
    }
  }, [])

  const unblock = async (user: BlockedUser) => {
    setBusy(user.id)
    setError(null)
    try {
      const res = await authFetch(`/api/blocks/${user.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setBlocked((prev) => prev?.filter((b) => b.id !== user.id) ?? null)
    } catch {
      setError('No se pudo desbloquear')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full flex-col font-ig text-ig-text">
      <header className="flex items-center gap-3 border-b border-ig-soft px-4 py-3">
        <button type="button" onClick={() => router.back()} aria-label="Volver" className="-ml-1 p-1">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-base font-bold">Cuentas bloqueadas</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {blocked === null && !error && (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-ig-muted" />
          </div>
        )}

        {blocked?.length === 0 && (
          <p className="py-16 text-center text-sm text-ig-muted">No bloqueaste a nadie.</p>
        )}

        <ul className="divide-y divide-ig-soft">
          {blocked?.map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-3">
              <StoryRing src={b.photo} size={44} ring={false} />
              <span className="flex-1 truncate text-sm font-semibold">{b.name}</span>
              <button
                type="button"
                onClick={() => unblock(b)}
                disabled={busy === b.id}
                className="rounded-lg bg-ig-soft px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
              >
                Desbloquear
              </button>
            </li>
          ))}
        </ul>

        {blocked && blocked.length > 0 && (
          <p className="mt-4 text-xs text-ig-muted">
            Al desbloquear vuelven a verse, pero no se recupera el match ni el chat.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-ig-like">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
