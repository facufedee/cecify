'use client'

import { useDialog } from '@/components/a11y/useDialog'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import { authFetch } from '@/lib/client-auth'
import type { ReportTarget } from '@/components/safety/useSafety'

const REASONS = [
  { value: 'inappropriate', label: 'Contenido inapropiado' },
  { value: 'harassment', label: 'Acoso o mensajes molestos' },
  { value: 'spam', label: 'Spam' },
  { value: 'fake', label: 'Perfil falso' },
  { value: 'other', label: 'Otro motivo' },
] as const

const DETAILS_MAX = 300

const WHAT: Record<ReportTarget['type'], string> = {
  profile: 'el perfil de',
  photo: 'una foto de',
  comment: 'un comentario de',
  story: 'una historia de',
  chat: 'la conversación con',
}

export default function ReportSheet({
  target,
  onClose,
  onBlock,
}: {
  target: ReportTarget
  onClose: () => void
  onBlock: () => void // ofrece bloquear despues de reportar
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dialogRef = useDialog<HTMLDivElement>(onClose)
  const submit = async () => {
    if (!reason || sending) return
    setSending(true)
    setError(null)
    try {
      const res = await authFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportedUserId: target.userId,
          reportedProfileId: target.profileId,
          type: target.type,
          targetId: target.targetId,
          conversationId: target.conversationId,
          photoId: target.photoId,
          reason,
          details,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo enviar el reporte')
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el reporte')
    } finally {
      setSending(false)
    }
  }

  return (
    <motion.div
      className="absolute inset-0 z-[45] flex flex-col justify-end bg-black/55 font-ig text-ig-text"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Reportar"
        className="outline-none max-h-[88%] overflow-y-auto rounded-t-2xl bg-white"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ig-soft py-3 text-center">
          <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-ig-border" />
          <h2 className="text-base font-semibold">Reportar</h2>
        </div>

        {sent ? (
          <div className="px-6 py-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Check size={28} strokeWidth={3} />
            </span>
            <h3 className="mt-4 text-lg font-bold">Gracias por avisarnos</h3>
            <p className="mt-1 text-sm text-ig-muted">
              Vamos a revisarlo. {target.name} no se entera de que lo reportaste.
            </p>
            <button
              type="button"
              onClick={onBlock}
              className="mt-6 w-full rounded-lg bg-ig-soft py-2.5 text-sm font-semibold text-ig-like"
            >
              Bloquear a {target.name}
            </button>
            <button type="button" onClick={onClose} className="mt-2 w-full rounded-lg py-2.5 text-sm font-semibold">
              Listo
            </button>
          </div>
        ) : (
          <div className="px-5 pb-6 pt-4">
            <p className="text-sm text-ig-muted">
              Estás reportando {WHAT[target.type]} <span className="font-semibold text-ig-text">{target.name}</span>.
              ¿Por qué?
            </p>

            <ul className="mt-3 divide-y divide-ig-soft" role="radiogroup" aria-label="Motivo">
              {REASONS.map((r) => (
                <li key={r.value}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={reason === r.value}
                    onClick={() => setReason(r.value)}
                    className="flex w-full items-center justify-between py-3 text-left text-sm"
                  >
                    {r.label}
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                        reason === r.value ? 'border-ig-link' : 'border-ig-border'
                      }`}
                    >
                      {reason === r.value && <span className="h-2.5 w-2.5 rounded-full bg-ig-link" />}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <label className="mt-4 block text-xs text-ig-muted">
              <span className="flex justify-between">
                Contanos qué pasó (opcional)
                <span>
                  {details.length}/{DETAILS_MAX}
                </span>
              </span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={DETAILS_MAX}
                rows={3}
                className="mt-1 w-full resize-none rounded-lg border border-ig-border p-2.5 text-sm text-ig-text outline-none focus:border-ig-text"
              />
            </label>

            {error && (
              <p role="alert" className="mt-3 text-center text-sm text-ig-like">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!reason || sending}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ig-link py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {sending && <Loader2 size={16} className="animate-spin" />}
              Enviar reporte
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
