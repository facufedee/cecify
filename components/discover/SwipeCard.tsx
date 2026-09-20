'use client'

import { useImperativeHandle, useRef, type Ref } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { Info } from 'lucide-react'
import { LOOKING_FOR_LABELS, SIDE_LABELS, type DiscoverProfile } from '@/lib/profile-schema'

export type SwipeAction = 'like' | 'skip'
export type SwipeCardHandle = { swipe: (action: SwipeAction) => void }

type Props = {
  profile: DiscoverProfile
  interactive: boolean
  onSwipe: (action: SwipeAction) => void
  onInfo: () => void
  handleRef?: Ref<SwipeCardHandle>
}

const DISTANCE = 110
const VELOCITY = 600

export default function SwipeCard({ profile, interactive, onSwipe, onInfo, handleRef }: Props) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-220, 220], [-14, 14])
  const likeOpacity = useTransform(x, [30, 120], [0, 1])
  const skipOpacity = useTransform(x, [-120, -30], [1, 0])
  const leaving = useRef(false)

  const fling = (action: SwipeAction) => {
    if (leaving.current) return
    leaving.current = true
    animate(x, action === 'like' ? 520 : -520, {
      duration: 0.25,
      ease: 'easeIn',
      onComplete: () => onSwipe(action),
    })
  }

  useImperativeHandle(handleRef, () => ({ swipe: fling }))

  const shown = profile.interests.slice(0, 3)

  return (
    <motion.div
      style={{ x, rotate }}
      drag={interactive ? 'x' : false}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (info.offset.x > DISTANCE || info.velocity.x > VELOCITY) fling('like')
        else if (info.offset.x < -DISTANCE || info.velocity.x < -VELOCITY) fling('skip')
        else animate(x, 0, { type: 'spring', stiffness: 500, damping: 35 })
      }}
      className="absolute inset-0 touch-pan-y select-none overflow-hidden rounded-[2rem] bg-cream shadow-lg"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={profile.mainPhotoUrl}
        alt={`Foto de ${profile.name}`}
        draggable={false}
        className="pointer-events-none h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />

      <motion.span
        style={{ opacity: likeOpacity }}
        className="pointer-events-none absolute left-5 top-6 -rotate-12 rounded-lg border-4 border-brand bg-white/85 px-3 py-1 text-xl font-extrabold tracking-wide text-brand"
      >
        ME GUSTA
      </motion.span>
      <motion.span
        style={{ opacity: skipOpacity }}
        className="pointer-events-none absolute right-5 top-6 rotate-12 rounded-lg border-4 border-neutral-500 bg-white/85 px-3 py-1 text-xl font-extrabold tracking-wide text-neutral-600"
      >
        PASO
      </motion.span>

      <button
        type="button"
        aria-label={`Ver perfil de ${profile.name}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onInfo}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm"
      >
        <Info size={20} />
      </button>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 text-white">
        <h2 className="text-2xl font-semibold">
          {profile.name}, {profile.age}
        </h2>
        {(profile.side || profile.lookingFor.length > 0) && (
          <p className="mt-0.5 text-xs font-medium text-white/80">
            {[
              profile.side && SIDE_LABELS[profile.side],
              profile.lookingFor.length > 0 &&
                `Busca: ${profile.lookingFor.map((v) => LOOKING_FOR_LABELS[v].toLowerCase()).join(' y ')}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {profile.bio && <p className="mt-1 line-clamp-2 text-sm text-white/85">{profile.bio}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {shown.map((interest) => {
            const common = profile.commonInterests.includes(interest)
            return (
              <span
                key={interest}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  common ? 'bg-brand text-white' : 'bg-white/20 text-white backdrop-blur-sm'
                }`}
              >
                {interest}
              </span>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
