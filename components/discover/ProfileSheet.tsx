'use client'

import { useDialog } from '@/components/a11y/useDialog'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { LOOKING_FOR_LABELS, SIDE_LABELS, type DiscoverProfile } from '@/lib/profile-schema'

export default function ProfileSheet({
  profile,
  onClose,
  onSafety,
}: {
  profile: DiscoverProfile
  onClose: () => void
  onSafety: () => void
}) {
  const photos = [profile.mainPhotoUrl, ...profile.additionalPhotos]

  const dialogRef = useDialog<HTMLDivElement>(onClose)
  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col justify-end bg-black/40"
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
        aria-label={`Perfil de ${profile.name}`}
        className="outline-none max-h-[88%] overflow-y-auto rounded-t-[2rem] bg-white pb-6"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <div className="flex snap-x snap-mandatory overflow-x-auto">
            {photos.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`Foto ${i + 1} de ${profile.name}`}
                className="aspect-[4/5] w-full shrink-0 snap-center object-cover"
              />
            ))}
          </div>
          {photos.length > 1 && (
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs text-white backdrop-blur-sm">
              Deslizá para ver más · {photos.length} fotos
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 pt-5">
          <h2 className="text-2xl font-semibold">
            {profile.name}, {profile.age}
          </h2>

          {profile.side && <p className="mt-0.5 text-sm text-neutral-500">{SIDE_LABELS[profile.side]}</p>}

          {profile.lookingFor.length > 0 && (
            <section className="mt-4">
              <h3 className="text-sm font-semibold text-neutral-500">Busca</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.lookingFor.map((v) => (
                  <span key={v} className="rounded-full bg-brand-soft px-3.5 py-1.5 text-sm font-medium text-brand-dark">
                    {LOOKING_FOR_LABELS[v]}
                  </span>
                ))}
              </div>
            </section>
          )}

          {profile.bio && (
            <section className="mt-4">
              <h3 className="text-sm font-semibold text-neutral-500">Sobre {profile.name}</h3>
              <p className="mt-1 text-sm leading-relaxed">{profile.bio}</p>
            </section>
          )}

          <section className="mt-5">
            <h3 className="text-sm font-semibold text-neutral-500">
              Intereses
              {profile.commonInterests.length > 0 && (
                <span className="ml-2 font-normal text-brand">
                  {profile.commonInterests.length} en común
                </span>
              )}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.interests.map((interest) => {
                const common = profile.commonInterests.includes(interest)
                return (
                  <span
                    key={interest}
                    className={`rounded-full border px-3.5 py-1.5 text-sm ${
                      common
                        ? 'border-brand bg-brand text-white'
                        : 'border-neutral-200 text-neutral-600'
                    }`}
                  >
                    {interest}
                  </span>
                )
              })}
            </div>
          </section>

          <button type="button" onClick={onSafety} className="mt-6 w-full py-2 text-sm font-medium text-red-600">
            Reportar o bloquear a {profile.name}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
