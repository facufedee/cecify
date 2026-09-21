'use client'

import { useDialog } from '@/components/a11y/useDialog'
import { motion } from 'framer-motion'
import { Heart } from 'lucide-react'

type Props = {
  myPhoto: string | null
  other: { name: string; mainPhotoUrl: string }
  onKeepGoing: () => void
  onMessage: () => void
}

const photoClass = 'h-28 w-28 rounded-full border-4 border-white object-cover shadow-lg'

export default function MatchOverlay({ myPhoto, other, onKeepGoing, onMessage }: Props) {

  const dialogRef = useDialog<HTMLDivElement>(onKeepGoing)

  return (
    <motion.div
      ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      aria-label="Nuevo match"
      className="focus-light outline-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-brand px-8 text-center text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.h2
        className="text-4xl font-bold"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
      >
        ¡Es un match!
      </motion.h2>
      <p className="mt-2 text-white">Vos y {other.name} se gustaron</p>

      <div className="relative mt-8 flex items-center">
        {myPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={myPhoto} alt="Tu foto" className={`${photoClass} -rotate-6`} />
        ) : (
          <span className={`block ${photoClass} bg-cream`} />
        )}
        <span className="z-10 -mx-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand shadow-lg">
          <Heart size={24} fill="currentColor" />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={other.mainPhotoUrl} alt={`Foto de ${other.name}`} className={`${photoClass} rotate-6`} />
      </div>

      <div className="mt-10 flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={onMessage}
          className="rounded-2xl bg-white py-3.5 font-medium text-brand"
        >
          Enviar mensaje
        </button>
        <button
          type="button"
          onClick={onKeepGoing}
          className="rounded-2xl border border-white/60 py-3.5 font-medium text-white"
        >
          Seguir descubriendo
        </button>
      </div>
    </motion.div>
  )
}
