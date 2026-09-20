import { supabaseServer } from '@/lib/supabase'
import type { Profile, ProfileInput } from '@/lib/profile-schema'

export type DbUser = { id: string; email: string; role: 'guest' | 'admin' }

// Solo en desarrollo: nunca se usa la base local en produccion
const useLocal = process.env.LOCAL_DB === '1' && process.env.NODE_ENV !== 'production'

const localDb = async () => (await import('@/lib/db-local')).getLocalDb()

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
})

export const findGuest = async (email: string, code: string) => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ id: string }>(
      'select id from guests where email = $1 and access_code = $2',
      [email, code]
    )
    return rows[0] ?? null
  }

  const { data, error } = await supabaseServer()
    .from('guests')
    .select('id')
    .eq('email', email)
    .eq('access_code', code)
    .maybeSingle()
  if (error) throw error
  return data
}

// Crea el user en el primer login; no toca role si ya existe
export const upsertUser = async (email: string): Promise<DbUser> => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<DbUser>(
      `insert into users (email) values ($1)
       on conflict (email) do update set email = excluded.email
       returning id, email, role`,
      [email]
    )
    return rows[0]
  }

  const { data, error } = await supabaseServer()
    .from('users')
    .upsert({ email }, { onConflict: 'email' })
    .select('id, email, role')
    .single()
  if (error) throw error
  return data as DbUser
}

// Perfil propio + nombre del invitado (para precargar el onboarding)
export const getUserContext = async (userId: string) => {
  if (useLocal) {
    const db = await localDb()
    const u = await db.query<{ email: string; guest_name: string | null }>(
      `select u.email, g.name as guest_name
         from users u left join guests g on g.email = u.email
        where u.id = $1`,
      [userId]
    )
    if (!u.rows[0]) return null
    const p = await db.query<ProfileRow>('select * from profiles where user_id = $1', [userId])
    return {
      email: u.rows[0].email,
      guestName: u.rows[0].guest_name,
      profile: p.rows[0] ? toProfile(p.rows[0]) : null,
    }
  }

  const supabase = supabaseServer()
  const { data: user, error } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!user) return null

  const [{ data: guest, error: gErr }, { data: profile, error: pErr }] = await Promise.all([
    supabase.from('guests').select('name').eq('email', user.email).maybeSingle(),
    supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
  ])
  if (gErr) throw gErr
  if (pErr) throw pErr

  return {
    email: user.email as string,
    guestName: (guest?.name as string | undefined) ?? null,
    profile: profile ? toProfile(profile as ProfileRow) : null,
  }
}

// Un perfil por usuario: si ya existe, se actualiza
export const upsertProfile = async (userId: string, input: ProfileInput): Promise<Profile> => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<ProfileRow>(
      `insert into profiles
         (user_id, name, age, bio, main_photo_url, additional_photos, interests, contact_methods)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       on conflict (user_id) do update set
         name = excluded.name, age = excluded.age, bio = excluded.bio,
         main_photo_url = excluded.main_photo_url,
         additional_photos = excluded.additional_photos,
         interests = excluded.interests, contact_methods = excluded.contact_methods
       returning *`,
      [
        userId,
        input.name,
        input.age,
        input.bio,
        input.mainPhotoUrl,
        JSON.stringify(input.additionalPhotos),
        JSON.stringify(input.interests),
        JSON.stringify(input.contactMethods),
      ]
    )
    return toProfile(rows[0])
  }

  const { data, error } = await supabaseServer()
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        name: input.name,
        age: input.age,
        bio: input.bio,
        main_photo_url: input.mainPhotoUrl,
        additional_photos: input.additionalPhotos,
        interests: input.interests,
        contact_methods: input.contactMethods,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return toProfile(data as ProfileRow)
}

// Solo base local (usado por /api/dev/reset-profile)
export const resetProfile = async (userId: string) => {
  if (!useLocal) throw new Error('resetProfile solo esta disponible con LOCAL_DB=1')
  const db = await localDb()
  await db.query('delete from profiles where user_id = $1', [userId])
}
