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

export type ContactMethods = { instagram?: string; whatsapp?: string }

export type ProfileInput = {
  name: string
  age: number
  bio: string
  mainPhotoUrl: string
  additionalPhotos: string[]
  interests: string[]
  contactMethods: ContactMethods
}

export type Profile = ProfileInput & { id: string; userId: string }

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

  const interests = Array.isArray(b.interests) ? b.interests : []
  const validInterests = new Set<string>(INTERESTS)
  if (
    interests.length < 1 ||
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
  if (!contactMethods.instagram && !contactMethods.whatsapp) {
    return { ok: false, error: 'Agregá al menos un medio de contacto' }
  }

  return {
    ok: true,
    data: {
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
}
