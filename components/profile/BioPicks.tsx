'use client'

import { useState, type RefObject } from 'react'
import { BIO_LIKES, BIO_TEAMS, bioLikes, bioTeam, setBioTeam, startOtherTeam, toggleBioLike } from '@/lib/bio-picks'

const EMOJI: Record<(typeof BIO_LIKES)[number], string> = {
  'el fútbol': '⚽',
  bailar: '💃',
  cocinar: '🍳',
  'lo dulce': '🍰',
  'el asado': '🥩',
  'el mate': '🧉',
  viajar: '✈️',
  'la música': '🎶',
}

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition ${
    on ? 'border-brand bg-brand text-white' : 'border-neutral-200 bg-white text-neutral-600 hover:border-brand'
  }`

const label = (like: string) => like.charAt(0).toUpperCase() + like.slice(1)

type Props = {
  bio: string
  max: number
  onChange: (bio: string) => void
  // El campo de texto del "Sobre vos": con "Otro equipo" se lleva ahi el foco para escribir el nombre
  textarea: RefObject<HTMLTextAreaElement | null>
}

// Botones para armar el "Sobre vos" tocando en vez de escribir. Van debajo del campo de texto.
export default function BioPicks({ bio, max, onChange, textarea }: Props) {
  const [full, setFull] = useState(false)
  const likes = bioLikes(bio)
  const team = bioTeam(bio)
  const otherTeam = team !== null && !(BIO_TEAMS as readonly string[]).includes(team)

  const apply = (next: string) => {
    // Sacar siempre se puede; sumar solo si entra
    if (next.length > max && next.length > bio.length) {
      setFull(true)
      return
    }
    setFull(false)
    onChange(next)
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="mb-1.5 text-xs text-neutral-500">Me gusta… (tocá los que quieras)</p>
        <div className="flex flex-wrap gap-1.5">
          {BIO_LIKES.map((like) => {
            const on = likes.includes(like)
            return (
              <button key={like} type="button" aria-pressed={on} className={chip(on)} onClick={() => apply(toggleBioLike(bio, like))}>
                <span aria-hidden>{EMOJI[like]}</span> {label(like)}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-neutral-500">Soy hincha de…</p>
        <div className="flex flex-wrap gap-1.5">
          {BIO_TEAMS.map((t) => (
            <button key={t} type="button" aria-pressed={team === t} className={chip(team === t)} onClick={() => apply(setBioTeam(bio, t))}>
              {t}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={otherTeam}
            className={chip(otherTeam)}
            onClick={() => {
              if (!otherTeam) apply(startOtherTeam(bio))
              const el = textarea.current
              if (!el) return
              el.focus()
              // despues de que React actualice el texto: cursor al final, justo despues de "Hincha de "
              requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
            }}
          >
            Otro…
          </button>
        </div>
      </div>

      {full && (
        <p role="status" className="text-xs text-amber-700">
          No entra más: sacá algo o acortá el texto ({max} caracteres como máximo).
        </p>
      )}
    </div>
  )
}
