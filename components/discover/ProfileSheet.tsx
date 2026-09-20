'use client'

import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { DiscoverProfile } from '@/lib/profile-schema'

export default function ProfileSheet({
  profile,
  onClose,
}: {
  profile: DiscoverProfile
  onClose: () => void
}) {
  const photos = [profile.mainPhotoUrl, ...profile.additionalPhotos]

  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col justify-end bg-black/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-label={`Perfil de ${profile.name}`}
        className="max-h-[88%] overflow-y-auto rounded-t-[2rem] bg-white pb-6"
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
        </div>
      </motion.div>
    </motion.div>
  )
}
