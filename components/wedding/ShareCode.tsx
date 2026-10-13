'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { shareLink } from '@/lib/wedding-client'

// El codigo del casamiento en grande y el link para mandarles a los invitados, con boton para copiarlo.
// Lo usan "Crear su casamiento" y el panel (seccion Casamiento).
export default function ShareCode({ code }: { code: string }) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const linkRef = useRef<HTMLInputElement>(null)

  // window solo existe en el navegador: se lee despues de montar
  useEffect(() => {
    const t = setTimeout(() => setOrigin(window.location.origin), 0)
    return () => clearTimeout(t)
  }, [])

  const link = origin ? shareLink(origin, code) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sin permiso para el portapapeles: deja el link seleccionado para copiarlo a mano
      linkRef.current?.select()
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Código del casamiento</p>
        <p className="mt-1 font-mono text-4xl font-bold tracking-[0.25em] text-brand-dark" aria-label={`Código ${code.split('').join(' ')}`}>
          {code}
        </p>
      </div>
      <div>
        <span className="mb-1 block text-sm font-medium">Link para los invitados</span>
        <div className="flex gap-2">
          <input
            ref={linkRef}
            readOnly
            value={link}
            aria-label="Link para los invitados"
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={copy}
            disabled={!link}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="mt-1 text-xs text-neutral-500" aria-live="polite">
          Quien lo abre entra directo a su casamiento. También pueden escribir el código en la entrada de Lovify.
        </p>
      </div>
    </div>
  )
}
