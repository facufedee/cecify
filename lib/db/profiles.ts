// Perfiles
import type { LookingFor, Profile, ProfileInput, Side } from '@/lib/profile-schema'
import type { Role } from '@/lib/roles'
import { callFn } from '@/lib/db/core'

// Fila de `profiles` tal como la devuelven las funciones SQL (to_jsonb)
type ProfileRow = {
  id: string
  user_id: string
  name: string
  age: number | null
  bio: string | null
  main_photo_url: string | null
  additional_photos: string[] | null
  interests: string[] | null
  contact_methods: Profile['contactMethods'] | null
  visibility: boolean | null
  wants_match: boolean
  looking_for: LookingFor[] | null
  side: Side | null
}

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  age: r.age ?? 0,
  bio: r.bio ?? '',
  mainPhotoUrl: r.main_photo_url ?? '',
  additionalPhotos: r.additional_photos ?? [],
  interests: r.interests ?? [],
  contactMethods: r.contact_methods ?? {},
  visible: r.visibility ?? true,
  wantsMatch: r.wants_match,
  lookingFor: r.looking_for ?? [],
  side: r.side,
})

// Perfil propio + datos del invitado (para precargar el onboarding) + rol
export const getUserContext = async (userId: string) => {
  const [r] = await callFn<{
    out_email: string
    out_role: Role
    out_guest_name: string | null
    out_guest_side: Side | null
    out_matches_count: number
    out_profile: ProfileRow | null
  }>('get_user_context', { p_user: userId })
  if (!r) return null
  return {
    email: r.out_email,
    role: r.out_role,
    guestName: r.out_guest_name,
    guestSide: r.out_guest_side,
    matchesCount: r.out_matches_count,
    profile: r.out_profile ? toProfile(r.out_profile) : null,
  }
}

// Un perfil por usuario: si ya existe, se actualiza
export const upsertProfile = async (userId: string, input: ProfileInput): Promise<Profile> => {
  const [r] = await callFn<{ out_profile: ProfileRow }>('upsert_profile', {
    p_user: userId,
    p_name: input.name,
    p_age: input.age,
    p_bio: input.bio,
    p_main_photo_url: input.mainPhotoUrl,
    p_additional_photos: input.additionalPhotos,
    p_interests: input.interests,
    p_contact_methods: input.contactMethods,
    p_visibility: input.visible,
    p_wants_match: input.wantsMatch,
    p_looking_for: input.lookingFor,
    p_side: input.side,
  })
  return toProfile(r.out_profile)
}

// Datos publicos del autor (cabecera del perfil con grilla, avisos)
export const getAuthor = async (userId: string) => {
  const [r] = await callFn<{ out_name: string; out_photo: string | null; out_bio: string | null }>('get_author', {
    p_user: userId,
  })
  return r ? { name: r.out_name, photo: r.out_photo ?? '', bio: r.out_bio ?? '' } : null
}

// A quien pertenece un perfil. Descubrir no expone ids de usuario: los reportes, bloqueos y swipes pueden venir
// con el id de perfil. null = el perfil no existe.
export const getProfileOwner = async (profileId: string) => {
  const [r] = await callFn<{ out_user: string; out_name: string; out_photo: string | null }>('get_profile_owner', {
    p_profile: profileId,
  })
  return r ? { userId: r.out_user, name: r.out_name, mainPhotoUrl: r.out_photo ?? '' } : null
}

export const userIdForProfile = async (profileId: string) => (await getProfileOwner(profileId))?.userId ?? null
