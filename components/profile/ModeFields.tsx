'use client'

import { Camera, Heart } from 'lucide-react'
import {
  LOOKING_FOR,
  LOOKING_FOR_LABELS,
  SIDES,
  SIDE_LABELS,
  type LookingFor,
  type Side,
} from '@/lib/profile-schema'

const card = (on: boolean) =>
  `flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition ${
    on ? 'border-brand bg-brand-soft' : 'border-neutral-200 bg-white hover:border-brand'
  }`

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-2 text-sm transition ${
    on ? 'border-brand bg-brand text-white' : 'border-neutral-200 bg-white text-neutral-600 hover:border-brand'
  }`

type Props = {
  side: Side | null
  wantsMatch: boolean | null
  lookingFor: LookingFor[]
  onSide: (s: Side) => void
  onWantsMatch: (v: boolean) => void
  onLookingFor: (v: LookingFor[]) => void
}

// De parte de quien venis, si queres hacer match o solo usar el muro, y que buscas.
// Lo usan el onboarding y la edicion del perfil.
export default function ModeFields({ side, wantsMatch, lookingFor, onSide, onWantsMatch, onLookingFor }: Props) {
  const toggleLooking = (v: LookingFor) =>
    onLookingFor(lookingFor.includes(v) ? lookingFor.filter((x) => x !== v) : [...lookingFor, v])

  return (
    <div className="space-y-7">
      <section>
        <h2 className="mb-3 text-sm font-medium">¿De parte de quién venís?</h2>
        <div role="radiogroup" aria-label="De parte de quién venís" className="flex flex-wrap gap-2">
          {SIDES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => onSide(s)}
              className={chip(side === s)}
            >
              {SIDE_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">¿Qué querés hacer en Cecify?</h2>
        <div role="radiogroup" aria-label="Qué querés hacer" className="space-y-2.5">
          <button
            type="button"
            role="radio"
            aria-checked={wantsMatch === true}
            onClick={() => onWantsMatch(true)}
            className={card(wantsMatch === true)}
          >
            <Heart size={22} className="mt-0.5 shrink-0 text-brand" />
            <span>
              <span className="block text-sm font-semibold">Conocer gente</span>
              <span className="block text-xs text-neutral-500">
                Descubrí invitados, hacé match y chateá. Además de subir fotos e historias.
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={wantsMatch === false}
            onClick={() => onWantsMatch(false)}
            className={card(wantsMatch === false)}
          >
            <Camera size={22} className="mt-0.5 shrink-0 text-brand" />
            <span>
              <span className="block text-sm font-semibold">Solo compartir momentos</span>
              <span className="block text-xs text-neutral-500">
                Subí fotos e historias y mirá el muro. No aparecés en Descubrir ni recibís matches.
              </span>
            </span>
          </button>
        </div>
      </section>

      {wantsMatch === true && (
        <section>
          <h2 className="mb-1 text-sm font-medium">¿Qué estás buscando?</h2>
          <p className="mb-3 text-xs text-neutral-500">Podés elegir las dos.</p>
          <div className="flex flex-wrap gap-2">
            {LOOKING_FOR.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={lookingFor.includes(v)}
                onClick={() => toggleLooking(v)}
                className={chip(lookingFor.includes(v))}
              >
                {LOOKING_FOR_LABELS[v]}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
