// Reglas del perfil compartidas entre cliente (validacion inmediata) y servidor (la que vale).

export const NAME_MAX = 100
export const BIO_MAX = 100
export const AGE_MIN = 18
export const AGE_MAX = 99
export const MAX_INTERESTS = 8
export const MAX_EXTRA_PHOTOS = 3

export const INTERESTS = [
  'Música',
  'Baile',
  'Viajes',
  'Cine y series',
  'Deportes',
  'Gastronomía',
  'Vino',
  'Fotografía',
  'Lectura',
  'Gaming',
  'Naturaleza',
  'Arte',
  'Mascotas',
  'Tecnología',
  'Fitness',
  'Idiomas',
] as const

export const COUPLE = { bride: 'Cecilia', groom: 'Lucas' } as const

// De parte de quien viene el invitado
export const SIDES = ['bride', 'groom', 'both'] as const
export type Side = (typeof SIDES)[number]
export const SIDE_LABELS: Record<Side, string> = {
  bride: `Del lado de ${COUPLE.bride}`,
  groom: `Del lado de ${COUPLE.groom}`,
  both: 'De los dos',
}
export const isSide = (v: unknown): v is Side => typeof v === 'string' && (SIDES as readonly string[]).includes(v)

// Que busca quien quiere hacer match (se pueden las dos)
export const LOOKING_FOR = ['meet', 'dance'] as const
export type LookingFor = (typeof LOOKING_FOR)[number]
export const LOOKING_FOR_LABELS: Record<LookingFor, string> = {
  meet: 'Conocer a alguien',
  dance: 'Pareja de baile',
}

export type ContactMethods = { instagram?: string; whatsapp?: string }

export type ProfileInput = {
  name: string
  age: number
  bio: string
  mainPhotoUrl: string
  additionalPhotos: string[]
  interests: string[]
  contactMethods: ContactMethods
  // Si es false, no aparece en Descubrir (los matches existentes siguen)
  visible: boolean
  // false = solo muro e historias: sin Descubrir, likes ni matches nuevos
  wantsMatch: boolean
  lookingFor: LookingFor[]
  side: Side
}

// side es null en perfiles anteriores a que se pidiera: se completa al editar
export type Profile = Omit<ProfileInput, 'side'> & { id: string; userId: string; side: Side | null }

const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/
const WHATSAPP_RE = /^\+?\d{8,15}$/

export const normalizeInstagram = (v: string) => v.trim().replace(/^@/, '')
export const normalizeWhatsapp = (v: string) => v.replace(/[\s\-().]/g, '')

type Result = { ok: true; data: ProfileInput } | { ok: false; error: string }

export const validateProfileInput = (body: unknown): Result => {
  const b = (body ?? {}) as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name || name.length > NAME_MAX) return { ok: false, error: 'Nombre inválido' }

  const age = b.age
  if (typeof age !== 'number' || !Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) {
    return { ok: false, error: `La edad debe estar entre ${AGE_MIN} y ${AGE_MAX}` }
  }

  const bio = typeof b.bio === 'string' ? b.bio.trim() : ''
  if (bio.length > BIO_MAX) return { ok: false, error: `La bio admite hasta ${BIO_MAX} caracteres` }

  const mainPhotoUrl = typeof b.mainPhotoUrl === 'string' ? b.mainPhotoUrl : ''
  if (!mainPhotoUrl || mainPhotoUrl.length > 500) {
    return { ok: false, error: 'Falta la foto principal' }
  }

  const extra = Array.isArray(b.additionalPhotos) ? b.additionalPhotos : []
  if (
    extra.length > MAX_EXTRA_PHOTOS ||
    extra.some((u) => typeof u !== 'string' || !u || u.length > 500)
  ) {
    return { ok: false, error: 'Fotos adicionales inválidas' }
  }

  if (b.wantsMatch !== undefined && typeof b.wantsMatch !== 'boolean') {
    return { ok: false, error: 'Modo inválido' }
  }
  const wantsMatch = b.wantsMatch !== false

  if (!isSide(b.side)) return { ok: false, error: 'Elegí de parte de quién venís' }

  // Quien no participa del match no elige que busca
  let lookingFor: LookingFor[] = []
  if (wantsMatch) {
    const raw = Array.isArray(b.lookingFor) ? b.lookingFor : []
    const valid = new Set<string>(LOOKING_FOR)
    if (
      raw.length < 1 ||
      new Set(raw).size !== raw.length ||
      raw.some((v) => typeof v !== 'string' || !valid.has(v))
    ) {
      return { ok: false, error: 'Elegí qué estás buscando' }
    }
    lookingFor = raw as LookingFor[]
  }

  // Intereses y contacto solo son obligatorios para quien participa del match
  const interests = Array.isArray(b.interests) ? b.interests : []
  const validInterests = new Set<string>(INTERESTS)
  if (
    interests.length < (wantsMatch ? 1 : 0) ||
    interests.length > MAX_INTERESTS ||
    new Set(interests).size !== interests.length ||
    interests.some((i) => typeof i !== 'string' || !validInterests.has(i))
  ) {
    return { ok: false, error: `Elegí entre 1 y ${MAX_INTERESTS} intereses` }
  }

  const cm = (b.contactMethods ?? {}) as Record<string, unknown>
  const contactMethods: ContactMethods = {}
  if (typeof cm.instagram === 'string' && cm.instagram.trim()) {
    const ig = normalizeInstagram(cm.instagram)
    if (!INSTAGRAM_RE.test(ig)) return { ok: false, error: 'Usuario de Instagram inválido' }
    contactMethods.instagram = ig
  }
  if (typeof cm.whatsapp === 'string' && cm.whatsapp.trim()) {
    const wa = normalizeWhatsapp(cm.whatsapp)
    if (!WHATSAPP_RE.test(wa)) return { ok: false, error: 'Número de WhatsApp inválido' }
    contactMethods.whatsapp = wa
  }
  if (wantsMatch && !contactMethods.instagram && !contactMethods.whatsapp) {
    return { ok: false, error: 'Agregá al menos un medio de contacto' }
  }

  if (b.visible !== undefined && typeof b.visible !== 'boolean') {
    return { ok: false, error: 'Visibilidad inválida' }
  }

  return {
    ok: true,
    data: {
      visible: b.visible !== false,
      wantsMatch,
      lookingFor,
      side: b.side,
      name,
      age,
      bio,
      mainPhotoUrl,
      additionalPhotos: extra as string[],
      interests: interests as string[],
      contactMethods,
    },
  }
}

// Lo que ve otro invitado en Discover: nunca incluye contacto ni userId
export type DiscoverProfile = {
  id: string
  name: string
  age: number
  bio: string
  mainPhotoUrl: string
  additionalPhotos: string[]
  interests: string[]
  commonInterests: string[]
  side: Side | null
  lookingFor: LookingFor[]
}
