'use client'

import {
  AGE_MAX,
  AGE_MIN,
  GENDERS,
  GENDER_LABELS,
  INTERESTED_IN,
  INTERESTED_IN_LABELS,
  type MatchPrefs,
} from '@/lib/profile-schema'

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-2 text-sm transition ${
    on ? 'border-brand bg-brand text-white' : 'border-neutral-200 bg-white text-neutral-600 hover:border-brand'
  }`

const select =
  'rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-brand'

const AGES = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i)

type Props = { prefs: MatchPrefs; onChange: (p: MatchPrefs) => void }

// Quien soy, a quien quiero conocer y en que rango de edad. Descubrir muestra solo a quien encaja en los dos sentidos.
export default function MatchPrefsFields({ prefs, onChange }: Props) {
  const set = (changes: Partial<MatchPrefs>) => onChange({ ...prefs, ...changes })

  return (
    <div className="space-y-7">
      <section>
        <h2 className="mb-3 text-sm font-medium">
          Soy {prefs.gender === null && <span className="font-normal text-neutral-500">· elegí una opción</span>}
        </h2>
        <div role="radiogroup" aria-label="Soy" className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={prefs.gender === g} onClick={() => set({ gender: g })} className={chip(prefs.gender === g)}>
              {GENDER_LABELS[g]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">
          Quiero conocer {prefs.interestedIn === null && <span className="font-normal text-neutral-500">· elegí una opción</span>}
        </h2>
        <div role="radiogroup" aria-label="Quiero conocer" className="flex flex-wrap gap-2">
          {INTERESTED_IN.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={prefs.interestedIn === v}
              onClick={() => set({ interestedIn: v })}
              className={chip(prefs.interestedIn === v)}
            >
              {INTERESTED_IN_LABELS[v]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Edad</h2>
        <p className="mb-3 text-xs text-neutral-500">Solo vas a ver (y te van a ver) personas en este rango.</p>
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <span>De</span>
          <select
            aria-label="Edad mínima"
            className={select}
            value={prefs.prefAgeMin}
            // Si el minimo pasa al maximo, el maximo lo acompaña (nunca queda un rango imposible)
            onChange={(e) => {
              const min = Number(e.target.value)
              set({ prefAgeMin: min, prefAgeMax: Math.max(min, prefs.prefAgeMax) })
            }}
          >
            {AGES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span>a</span>
          <select
            aria-label="Edad máxima"
            className={select}
            value={prefs.prefAgeMax}
            onChange={(e) => {
              const max = Number(e.target.value)
              set({ prefAgeMax: max, prefAgeMin: Math.min(max, prefs.prefAgeMin) })
            }}
          >
            {AGES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <span>años</span>
        </div>
      </section>
    </div>
  )
}
