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
export const resetProfile = async (userId: string, only?: 'swipes') => {
  if (!useLocal) throw new Error('resetProfile solo esta disponible con LOCAL_DB=1')
  const db = await localDb()
  // matches -> conversations -> messages caen en cascada
  await db.query('delete from matches where user1_id = $1 or user2_id = $1', [userId])
  await db.query('delete from swipes where from_user_id = $1 or to_user_id = $1', [userId])
  if (only !== 'swipes') await db.query('delete from profiles where user_id = $1', [userId])
}

// ---- Discover / swipes ----

type DiscoverRow = {
  id: string
  name: string
  age: number | null
  bio: string | null
  main_photo_url: string
  additional_photos: string[] | null
  interests: string[] | null
}

export const discoverProfiles = async (userId: string, exclude: string[], limit = 10) => {
  let rows: DiscoverRow[]
  if (useLocal) {
    const db = await localDb()
    rows = (
      await db.query<DiscoverRow>('select * from discover_profiles($1, $2, $3::uuid[])', [
        userId,
        limit,
        exclude,
      ])
    ).rows
  } else {
    const { data, error } = await supabaseServer().rpc('discover_profiles', {
      p_user: userId,
      p_limit: limit,
      p_exclude: exclude,
    })
    if (error) throw error
    rows = data as DiscoverRow[]
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    age: r.age ?? 0,
    bio: r.bio ?? '',
    mainPhotoUrl: r.main_photo_url,
    additionalPhotos: r.additional_photos ?? [],
    interests: r.interests ?? [],
  }))
}

type SwipeRow = { matched: boolean; match_row_id: string | null; was_duplicate: boolean }

export type SwipeResult =
  | { status: 'not_found' }
  | { status: 'self' }
  | {
      status: 'ok'
      matched: boolean
      matchId: string | null
      duplicate: boolean
      target: { name: string; mainPhotoUrl: string }
    }

// Swipe sobre un perfil (por id de perfil). El match se decide dentro de record_swipe (SQL).
export const recordSwipe = async (
  fromUserId: string,
  profileId: string,
  action: 'like' | 'skip'
): Promise<SwipeResult> => {
  let target: { userId: string; name: string; mainPhotoUrl: string; email?: string } | null

  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ user_id: string; name: string; main_photo_url: string; email: string }>(
      `select p.user_id, p.name, p.main_photo_url, u.email
         from profiles p join users u on u.id = p.user_id where p.id = $1`,
      [profileId]
    )
    target = rows[0]
      ? { userId: rows[0].user_id, name: rows[0].name, mainPhotoUrl: rows[0].main_photo_url, email: rows[0].email }
      : null
  } else {
    const { data, error } = await supabaseServer()
      .from('profiles')
      .select('user_id, name, main_photo_url')
      .eq('id', profileId)
      .maybeSingle()
    if (error) throw error
    target = data
      ? { userId: data.user_id, name: data.name, mainPhotoUrl: data.main_photo_url ?? '' }
      : null
  }

  if (!target) return { status: 'not_found' }
  if (target.userId === fromUserId) return { status: 'self' }

  let row: SwipeRow
  if (useLocal) {
    const db = await localDb()
    // SOLO DESARROLLO: los invitados demo impares (demo1, demo3, demo5) le dan like de vuelta
    // a quien les da like, para poder ver la pantalla de match sin dos personas reales.
    const demo = target.email?.match(/^demo(\d+)@demo\.cecify\.local$/)
    if (action === 'like' && demo && Number(demo[1]) % 2 === 1) {
      await db.query(
        `insert into swipes (from_user_id, to_user_id, action) values ($1, $2, 'like') on conflict do nothing`,
        [target.userId, fromUserId]
      )
    }
    row = (
      await db.query<SwipeRow>('select * from record_swipe($1, $2, $3::swipe_action)', [
        fromUserId,
        target.userId,
        action,
      ])
    ).rows[0]
  } else {
    const { data, error } = await supabaseServer().rpc('record_swipe', {
      p_from: fromUserId,
      p_to: target.userId,
      p_action: action,
    })
    if (error) throw error
    row = (data as SwipeRow[])[0]
  }

  return {
    status: 'ok',
    matched: row.matched,
    matchId: row.match_row_id,
    duplicate: row.was_duplicate,
    target: { name: target.name, mainPhotoUrl: target.mainPhotoUrl },
  }
}
