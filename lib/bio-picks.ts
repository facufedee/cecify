// Atajos para escribir el "Sobre vos" tocando botones (en el celular, en plena fiesta, es mas rapido que tipear).
// El resultado es texto comun: se puede seguir editando a mano. Cada parte va separada por " · ", p. ej.
//   "Me gusta bailar, cocinar y lo dulce · Hincha de Racing · Amigo de la novia desde la facu"
// Sin dependencias: lo usan el onboarding y Editar perfil.

export const BIO_LIKES = [
  'el fútbol',
  'bailar',
  'cocinar',
  'lo dulce',
  'el asado',
  'el mate',
  'viajar',
  'la música',
] as const

export const BIO_TEAMS = ['River', 'Boca', 'Independiente', 'Racing', 'San Lorenzo'] as const

const SEP = ' · '
const LIKES_PREFIX = 'Me gusta '
const TEAM_PREFIX = 'Hincha de '

const segments = (bio: string) =>
  bio
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean)

const join = (parts: string[]) => parts.join(SEP)

// "a" | "a y b" | "a, b y c"
const formatList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`

const parseList = (text: string) =>
  text
    .split(/\s*,\s*|\s+y\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

const isLikes = (s: string) => s.startsWith(LIKES_PREFIX)
const isTeam = (s: string) => s === 'Hincha de' || s.startsWith(TEAM_PREFIX)

// Lo que ya dice el texto (para marcar los botones como elegidos)
export const bioLikes = (bio: string) => parseList(segments(bio).find(isLikes)?.slice(LIKES_PREFIX.length) ?? '')
export const bioTeam = (bio: string) => segments(bio).find(isTeam)?.slice(TEAM_PREFIX.length).trim() ?? null

// Suma o saca un gusto. Todos los gustos van en una sola frase: "Me gusta bailar, cocinar y lo dulce".
export const toggleBioLike = (bio: string, like: string) => {
  const parts = segments(bio)
  const i = parts.findIndex(isLikes)
  const current = i >= 0 ? parseList(parts[i].slice(LIKES_PREFIX.length)) : []
  const next = current.includes(like) ? current.filter((l) => l !== like) : [...current, like]
  const phrase = next.length ? `${LIKES_PREFIX}${formatList(next)}` : null

  if (i >= 0) {
    if (phrase) parts[i] = phrase
    else parts.splice(i, 1)
  } else if (phrase) {
    parts.unshift(phrase) // los gustos van primero
  }
  return join(parts)
}

// Elige el equipo (uno solo: elegir otro lo reemplaza; elegir el mismo lo saca; null lo saca).
export const setBioTeam = (bio: string, team: string | null) => {
  const parts = segments(bio)
  const i = parts.findIndex(isTeam)
  const same = i >= 0 && parts[i].slice(TEAM_PREFIX.length).trim() === team
  if (i >= 0) parts.splice(i, 1)
  if (team === null || same) return join(parts)
  parts.splice(parts.findIndex(isLikes) + 1, 0, TEAM_PREFIX + team) // despues de los gustos
  return join(parts)
}

// "Otro equipo": deja "Hincha de " al final para que lo completen escribiendo
export const startOtherTeam = (bio: string) => {
  const parts = segments(bio).filter((p) => !isTeam(p))
  return parts.length ? `${join(parts)}${SEP}${TEAM_PREFIX}` : TEAM_PREFIX
}
