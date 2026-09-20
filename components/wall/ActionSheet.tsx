'use client'

import { motion } from 'framer-motion'

export type SheetAction = { label: string; onClick: () => void; destructive?: boolean }

// Menu centrado, como el de "más opciones" de Instagram
export default function ActionSheet({
  title,
  message,
  actions,
  onClose,
}: {
  title?: string
  message?: string // explicacion breve bajo el titulo
  actions: SheetAction[]
  onClose: () => void
}) {
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 px-10 font-ig"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-label={title ?? 'Opciones'}
        className="w-full max-w-xs overflow-hidden rounded-2xl bg-white text-center text-sm"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-ig-border px-5 py-5">
            <p className="text-base font-semibold">{title}</p>
            {message && <p className="mt-1.5 text-xs leading-relaxed text-ig-muted">{message}</p>}
          </div>
        )}
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={`block w-full border-b border-ig-border px-4 py-3.5 active:bg-ig-soft ${
              a.destructive ? 'font-bold text-ig-like' : ''
            }`}
          >
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onClose} className="block w-full px-4 py-3.5 active:bg-ig-soft">
          Cancelar
        </button>
      </motion.div>
    </motion.div>
  )
}
