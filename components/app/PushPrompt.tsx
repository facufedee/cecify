'use client'

import { useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'
import { usePush } from '@/components/app/usePush'
import { dismissPrompt, promptDismissed } from '@/lib/push-client'

// Invita a activar las notificaciones donde mas sirven (los matches). Se puede descartar y no vuelve a aparecer.
export default function PushPrompt() {
  const { state, busy, error, enable } = usePush()
  const [dismissed, setDismissed] = useState(promptDismissed)

  if (dismissed || (state !== 'off' && state !== 'needs-install')) return null

  const close = () => {
    dismissPrompt()
    setDismissed(true)
  }

  return (
    <div role="region" aria-label="Activar notificaciones" className="mx-4 mb-3 flex items-start gap-3 rounded-2xl bg-brand-soft px-4 py-3">
      <Bell size={20} className="mt-0.5 shrink-0 text-brand" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-brand-dark">No te pierdas un mensaje</p>
        <p className="mt-0.5 text-xs text-neutral-600">
          {state === 'needs-install'
            ? 'En iPhone, instalá la app (Compartir → "Agregar a pantalla de inicio") para recibir avisos de matches y mensajes.'
            : 'Activá las notificaciones y te avisamos de matches y mensajes nuevos, aunque tengas la app cerrada.'}
        </p>
        {state === 'off' && (
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {busy && <Loader2 size={13} className="animate-spin" />} Activar notificaciones
          </button>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      <button type="button" onClick={close} aria-label="Ahora no" className="shrink-0 p-1 text-neutral-500">
        <X size={16} />
      </button>
    </div>
  )
}
