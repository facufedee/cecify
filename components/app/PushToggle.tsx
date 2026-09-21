'use client'

import { usePush } from '@/components/app/usePush'

// Interruptor de "Notificaciones" de Editar perfil. Explica por que no se puede activar cuando no se puede.
export default function PushToggle() {
  const { state, busy, error, enable, disable } = usePush()
  if (state === null) return null

  const on = state === 'on'
  const canToggle = state === 'on' || state === 'off'

  const hint = {
    on: 'Te avisamos de mensajes y matches nuevos cuando no tengas la app abierta.',
    off: 'Enterate de mensajes y matches nuevos aunque no tengas la app abierta.',
    blocked: 'Las bloqueaste en tu navegador. Para activarlas, permitilas desde la configuración del sitio.',
    'needs-install': 'En iPhone funcionan con la app instalada: en Safari tocá Compartir y "Agregar a pantalla de inicio".',
    unsupported: 'Este navegador no permite notificaciones.',
    unavailable: 'Las notificaciones no están disponibles por ahora.',
  }[state]

  return (
    <section className="rounded-xl bg-ig-soft px-4 py-3" aria-label="Notificaciones">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Notificaciones</p>
          <p className="text-xs text-ig-muted">{hint}</p>
        </div>
        {canToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Notificaciones"
            disabled={busy}
            onClick={() => void (on ? disable() : enable())}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-ig-link' : 'bg-ig-border'}`}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[1.5rem]' : 'left-0.5'}`} />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-ig-like">
          {error}
        </p>
      )}
    </section>
  )
}
