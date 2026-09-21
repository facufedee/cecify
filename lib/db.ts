import { supabaseServer } from '@/lib/supabase'
import type { LookingFor, Profile, ProfileInput, Side } from '@/lib/profile-schema'
import type { PushSubscriptionJson } from '@/lib/push'
import type { Role } from '@/lib/roles'
import { forgetSession } from '@/lib/session'

export type DbUser = { id: string; email: string; role: Role; sessionVersion: number }

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
    const { rows } = await db.query<Omit<DbUser, 'sessionVersion'> & { session_version: number }>(
      `insert into users (email) values ($1)
       on conflict (email) do update set email = excluded.email
       returning id, email, role, session_version`,
      [email]
    )
    const { session_version, ...user } = rows[0]
    return { ...user, sessionVersion: session_version }
  }

  const { data, error } = await supabaseServer()
    .from('users')
    .upsert({ email }, { onConflict: 'email' })
    .select('id, email, role, session_version')
    .single()
  if (error) throw error
  return {
    id: data.id as string,
    email: data.email as string,
    role: data.role as Role,
    sessionVersion: data.session_version as number,
  }
}

// Version de sesion y rol actuales (null = el usuario ya no existe). Lo usa getAuth en cada pedido.
export const getSessionInfo = async (userId: string): Promise<{ version: number; role: Role } | null> => {
  const [r] = await callFn<{ out_version: number; out_role: Role }>('get_session_info', { p_user: userId })
  return r ? { version: r.out_version, role: r.out_role } : null
}

// Cierra todas las sesiones de la persona (en todos los dispositivos). Devuelve la version nueva.
export const revokeSessions = async (userId: string): Promise<number | null> => {
  const [r] = await callFn<{ out_version: number }>('revoke_sessions', { p_user: userId })
  forgetSession(userId)
  return r?.out_version ?? null
}

// Rol actual (siempre desde la base: el del token puede estar desactualizado hasta 12 h)
export const getUserRole = async (userId: string): Promise<Role | null> => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ role: Role }>('select role from users where id = $1', [userId])
    return rows[0]?.role ?? null
  }
  const { data, error } = await supabaseServer().from('users').select('role').eq('id', userId).maybeSingle()
  if (error) throw error
  return (data?.role as Role | undefined) ?? null
}

export type SetRoleStatus = 'ok' | 'invalid' | 'forbidden' | 'not_found' | 'last_superadmin'

// Solo un superadmin puede cambiar roles (lo decide set_user_role en SQL)
export const setUserRole = async (actorId: string, targetId: string, role: string): Promise<SetRoleStatus> => {
  const rows = await callFn<{ status: SetRoleStatus }>('set_user_role', {
    p_actor: actorId,
    p_target: targetId,
    p_role: role,
  })
  return rows[0].status
}

// Perfil propio + datos del invitado (para precargar el onboarding) + rol
export const getUserContext = async (userId: string) => {
  if (useLocal) {
    const db = await localDb()
    const u = await db.query<{
      email: string
      role: Role
      guest_name: string | null
      guest_side: Side | null
      matches_count: number
    }>(
      `select u.email, u.role, g.name as guest_name, g.side as guest_side,
              (select count(*)::int from matches m where m.user1_id = u.id or m.user2_id = u.id) as matches_count
         from users u left join guests g on g.email = u.email
        where u.id = $1`,
      [userId]
    )
    if (!u.rows[0]) return null
    const p = await db.query<ProfileRow>('select * from profiles where user_id = $1', [userId])
    return {
      email: u.rows[0].email,
      role: u.rows[0].role,
      guestName: u.rows[0].guest_name,
      guestSide: u.rows[0].guest_side,
      matchesCount: u.rows[0].matches_count,
      profile: p.rows[0] ? toProfile(p.rows[0]) : null,
    }
  }

  const supabase = supabaseServer()
  const { data: user, error } = await supabase
    .from('users')
    .select('email, role')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!user) return null

  const [{ data: guest, error: gErr }, { data: profile, error: pErr }, { count, error: cErr }] = await Promise.all([
    supabase.from('guests').select('name, side').eq('email', user.email).maybeSingle(),
    supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`),
  ])
  if (gErr) throw gErr
  if (pErr) throw pErr
  if (cErr) throw cErr

  return {
    email: user.email as string,
    role: user.role as Role,
    guestName: (guest?.name as string | undefined) ?? null,
    guestSide: (guest?.side as Side | undefined) ?? null,
    matchesCount: count ?? 0,
    profile: profile ? toProfile(profile as ProfileRow) : null,
  }
}

// Un perfil por usuario: si ya existe, se actualiza
export const upsertProfile = async (userId: string, input: ProfileInput): Promise<Profile> => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<ProfileRow>(
      `insert into profiles
         (user_id, name, age, bio, main_photo_url, additional_photos, interests, contact_methods, visibility,
          wants_match, looking_for, side)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9,
               $10, array(select jsonb_array_elements_text($11::jsonb)), $12)
       on conflict (user_id) do update set
         name = excluded.name, age = excluded.age, bio = excluded.bio,
         main_photo_url = excluded.main_photo_url,
         additional_photos = excluded.additional_photos,
         interests = excluded.interests, contact_methods = excluded.contact_methods,
         visibility = excluded.visibility, wants_match = excluded.wants_match,
         looking_for = excluded.looking_for, side = excluded.side
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
        input.visible,
        input.wantsMatch,
        JSON.stringify(input.lookingFor),
        input.side,
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
        visibility: input.visible,
        wants_match: input.wantsMatch,
        looking_for: input.lookingFor,
        side: input.side,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return toProfile(data as ProfileRow)
}

// Solo base local (usado por /api/dev/reset-profile)
export const resetProfile = async (userId: string, only?: 'swipes' | 'story-views') => {
  if (!useLocal) throw new Error('resetProfile solo esta disponible con LOCAL_DB=1')
  const db = await localDb()
  await db.query('delete from story_views where viewer_id = $1', [userId])
  if (only === 'story-views') return
  // matches -> conversations -> messages caen en cascada
  await db.query('delete from matches where user1_id = $1 or user2_id = $1', [userId])
  await db.query('delete from swipes where from_user_id = $1 or to_user_id = $1', [userId])
  await db.query('delete from blocks where blocker_id = $1 or blocked_id = $1', [userId])
  await db.query('delete from reports where reporter_id = $1 or reported_user_id = $1', [userId])
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
  side: Side | null
  looking_for: LookingFor[] | null
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
    side: r.side,
    lookingFor: r.looking_for ?? [],
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
      conversationId: string | null
      duplicate: boolean
      target: { userId: string; name: string; mainPhotoUrl: string }
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

  let conversationId: string | null = null
  if (row.matched && row.match_row_id) {
    conversationId = await conversationIdForMatch(row.match_row_id)
  }

  return {
    status: 'ok',
    matched: row.matched,
    matchId: row.match_row_id,
    conversationId,
    duplicate: row.was_duplicate,
    target: { userId: target.userId, name: target.name, mainPhotoUrl: target.mainPhotoUrl },
  }
}

const conversationIdForMatch = async (matchId: string) => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ id: string }>('select id from conversations where match_id = $1', [matchId])
    return rows[0]?.id ?? null
  }
  const { data, error } = await supabaseServer()
    .from('conversations')
    .select('id')
    .eq('match_id', matchId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

// ---- Matches y chat ----

// Llama una funcion SQL (supabase.rpc o, en local, select con argumentos con nombre).
// `fn` y las claves de `args` son constantes internas, nunca input del usuario.
export const callFn = async <T>(fn: string, args: Record<string, unknown>): Promise<T[]> => {
  if (useLocal) {
    const db = await localDb()
    const keys = Object.keys(args)
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
    const { rows } = await db.query<T>(`select * from ${fn}(${named})`, keys.map((k) => args[k]))
    return rows
  }
  const { data, error } = await supabaseServer().rpc(fn, args)
  if (error) throw error
  return (data ?? []) as T[]
}

export const iso = (v: string | Date) => new Date(v).toISOString()

export type Conversation = {
  id: string
  matchId: string
  matchedAt: string
  other: {
    userId: string
    profileId: string
    name: string
    age: number
    photo: string
    contact: { instagram?: string; whatsapp?: string }
  }
  lastMessage: { content: string; fromMe: boolean; at: string } | null
  unread: number
}

type ConversationRow = {
  conversation_id: string
  match_id: string
  matched_at: string | Date
  other_user_id: string
  other_profile_id: string
  other_name: string
  other_age: number | null
  other_photo: string | null
  other_contact: Conversation['other']['contact'] | null
  last_content: string | null
  last_from: string | null
  last_at: string | Date | null
  unread_count: number
}

export const listConversations = async (userId: string): Promise<Conversation[]> => {
  const rows = await callFn<ConversationRow>('list_conversations', { p_user: userId })
  return rows.map((r) => ({
    id: r.conversation_id,
    matchId: r.match_id,
    matchedAt: iso(r.matched_at),
    other: {
      userId: r.other_user_id,
      profileId: r.other_profile_id,
      name: r.other_name,
      age: r.other_age ?? 0,
      photo: r.other_photo ?? '',
      contact: r.other_contact ?? {},
    },
    lastMessage:
      r.last_content !== null && r.last_at
        ? { content: r.last_content, fromMe: r.last_from === userId, at: iso(r.last_at) }
        : null,
    unread: r.unread_count,
  }))
}

export type ChatMessage = {
  id: string
  conversationId: string
  fromUserId: string
  content: string
  createdAt: string
  isRead?: boolean
}

type MessageRow = {
  msg_id: string
  msg_from: string
  msg_content: string
  msg_is_read: boolean
  msg_created_at: string | Date
}

export const getMessages = async (
  userId: string,
  conversationId: string,
  opts: { before?: string; after?: string; limit?: number } = {}
): Promise<ChatMessage[]> => {
  const rows = await callFn<MessageRow>('get_messages', {
    p_user: userId,
    p_conversation: conversationId,
    p_before: opts.before ?? null,
    p_after: opts.after ?? null,
    p_limit: opts.limit ?? 50,
  })
  return rows.map((r) => ({
    id: r.msg_id,
    conversationId,
    fromUserId: r.msg_from,
    content: r.msg_content,
    createdAt: iso(r.msg_created_at),
    isRead: r.msg_is_read,
  }))
}

type SentRow = {
  msg_id: string
  msg_conversation_id: string
  msg_from: string
  msg_to: string
  msg_content: string
  msg_created_at: string | Date
}

// null = el usuario no participa de esa conversacion
export const sendMessage = async (
  userId: string,
  conversationId: string,
  content: string
): Promise<(ChatMessage & { toUserId: string }) | null> => {
  const [r] = await callFn<SentRow>('send_message', {
    p_from: userId,
    p_conversation: conversationId,
    p_content: content,
  })
  if (!r) return null
  return {
    id: r.msg_id,
    conversationId: r.msg_conversation_id,
    fromUserId: r.msg_from,
    toUserId: r.msg_to,
    content: r.msg_content,
    createdAt: iso(r.msg_created_at),
  }
}

// Marca como leido lo que le llego al usuario. `readUpTo` = fecha del ultimo mensaje marcado (null si no habia nada nuevo).
export const markRead = async (userId: string, conversationId: string) => {
  const [r] = await callFn<{ marked: number; read_up_to: string | Date | null }>('mark_read', {
    p_user: userId,
    p_conversation: conversationId,
  })
  return { marked: r?.marked ?? 0, readUpTo: r?.read_up_to ? iso(r.read_up_to) : null }
}

// Hasta cuando leyo la otra persona lo que el usuario le envio (null = nada leido todavia)
export const getReadState = async (userId: string, conversationId: string): Promise<string | null> => {
  const [r] = await callFn<{ out_read_up_to: string | Date | null }>('chat_read_state', {
    p_user: userId,
    p_conversation: conversationId,
  })
  return r?.out_read_up_to ? iso(r.out_read_up_to) : null
}

export const unreadTotal = async (userId: string) => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from messages
        where to_user_id = $1 and is_read = false and deleted_at is null`,
      [userId]
    )
    return rows[0].n
  }
  const { count, error } = await supabaseServer()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId)
    .eq('is_read', false)
    .is('deleted_at', null)
  if (error) throw error
  return count ?? 0
}

// SOLO DESARROLLO (LOCAL_DB=1): si el usuario es un invitado demo, para responderle solo.
export const isDemoUser = async (userId: string) => {
  if (!useLocal) return false
  const db = await localDb()
  const { rows } = await db.query<{ ok: boolean }>(
    "select email like 'demo%@demo.cecify.local' as ok from users where id = $1",
    [userId]
  )
  return rows[0]?.ok === true
}

// ---- Muro de fotos ----

export type WallPhoto = {
  id: string
  authorId: string
  authorName: string
  authorPhoto: string
  photoUrl: string
  caption: string | null
  likesCount: number
  commentsCount: number
  likedByMe: boolean
  createdAt: string
}

type WallPhotoRow = {
  photo_id: string
  author_id: string
  author_name: string
  author_photo: string | null
  photo_url: string
  caption: string | null
  likes_count: number
  comments_count: number
  liked_by_me: boolean
  created_at: string | Date
}

const toWallPhoto = (r: WallPhotoRow): WallPhoto => ({
  id: r.photo_id,
  authorId: r.author_id,
  authorName: r.author_name,
  authorPhoto: r.author_photo ?? '',
  photoUrl: r.photo_url,
  caption: r.caption,
  likesCount: r.likes_count,
  commentsCount: r.comments_count,
  likedByMe: r.liked_by_me,
  createdAt: iso(r.created_at),
})

export const listPhotos = async (
  userId: string,
  opts: { before?: string; author?: string; photo?: string; limit?: number } = {}
): Promise<WallPhoto[]> => {
  const rows = await callFn<WallPhotoRow>('list_photos', {
    p_user: userId,
    p_before: opts.before ?? null,
    p_author: opts.author ?? null,
    p_limit: opts.limit ?? 12,
    p_photo: opts.photo ?? null,
  })
  return rows.map(toWallPhoto)
}

export const createPhoto = async (userId: string, url: string, caption: string) => {
  const [r] = await callFn<{ new_photo_id: string }>('create_photo', {
    p_user: userId,
    p_url: url,
    p_caption: caption,
  })
  return (await listPhotos(userId, { photo: r.new_photo_id }))[0]
}

// Devuelve la url borrada (para limpiar el archivo) o null si no existe / no es del usuario
export const deletePhoto = async (userId: string, photoId: string) => {
  const [r] = await callFn<{ deleted_id: string; deleted_url: string }>('delete_photo', {
    p_user: userId,
    p_photo: photoId,
  })
  return r ? r.deleted_url : null
}

export const togglePhotoLike = async (userId: string, photoId: string) => {
  const [r] = await callFn<{ liked: boolean; total: number; photo_owner: string }>('toggle_photo_like', {
    p_user: userId,
    p_photo: photoId,
  })
  return r ? { liked: r.liked, likesCount: r.total, ownerId: r.photo_owner } : null
}

export type WallComment = {
  id: string
  authorId: string
  authorName: string
  authorPhoto: string
  body: string
  createdAt: string
}

type CommentRow = {
  comment_id: string
  author_id: string
  author_name: string
  author_photo: string | null
  body: string
  created_at: string | Date
}

export const listComments = async (viewerId: string, photoId: string): Promise<WallComment[]> => {
  const rows = await callFn<CommentRow>('list_comments', { p_viewer: viewerId, p_photo: photoId, p_limit: 100 })
  return rows.map((r) => ({
    id: r.comment_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorPhoto: r.author_photo ?? '',
    body: r.body,
    createdAt: iso(r.created_at),
  }))
}

// null = la foto no existe
export const addComment = async (
  userId: string,
  photoId: string,
  content: string
): Promise<WallComment | null> => {
  const [r] = await callFn<{ comment_id: string; created_at: string | Date }>('add_comment', {
    p_user: userId,
    p_photo: photoId,
    p_content: content,
  })
  if (!r) return null
  const author = await getAuthor(userId)
  return {
    id: r.comment_id,
    authorId: userId,
    authorName: author?.name ?? 'Invitado',
    authorPhoto: author?.photo ?? '',
    body: content.trim(),
    createdAt: iso(r.created_at),
  }
}

// Datos publicos del autor (cabecera del perfil con grilla)
export const getAuthor = async (userId: string) => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ name: string; main_photo_url: string | null; bio: string | null }>(
      'select name, main_photo_url, bio from profiles where user_id = $1',
      [userId]
    )
    return rows[0] ? { name: rows[0].name, photo: rows[0].main_photo_url ?? '', bio: rows[0].bio ?? '' } : null
  }
  const { data, error } = await supabaseServer()
    .from('profiles')
    .select('name, main_photo_url, bio')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ? { name: data.name as string, photo: (data.main_photo_url as string) ?? '', bio: (data.bio as string) ?? '' } : null
}

// ---- Historias (24 h) ----

export type StoryAuthor = {
  authorId: string
  name: string
  photo: string
  count: number
  latestAt: string
  hasUnseen: boolean
}

export type Story = {
  id: string
  photoUrl: string
  caption: string | null
  createdAt: string
  expiresAt: string
  seenByMe: boolean
  viewsCount: number | null // solo lo ve el autor
}

export type StoryViewerInfo = { id: string; name: string; photo: string; viewedAt: string }

export const listStoryRings = async (userId: string): Promise<StoryAuthor[]> => {
  const rows = await callFn<{
    author_id: string
    author_name: string
    author_photo: string | null
    stories_count: number
    latest_at: string | Date
    has_unseen: boolean
  }>('list_story_rings', { p_user: userId })
  return rows.map((r) => ({
    authorId: r.author_id,
    name: r.author_name,
    photo: r.author_photo ?? '',
    count: r.stories_count,
    latestAt: iso(r.latest_at),
    hasUnseen: r.has_unseen,
  }))
}

export const listStories = async (userId: string, authorId: string): Promise<Story[]> => {
  const rows = await callFn<{
    story_id: string
    photo_url: string
    caption: string | null
    created_at: string | Date
    expires_at: string | Date
    seen_by_me: boolean
    views_count: number | null
  }>('list_stories', { p_user: userId, p_author: authorId })
  return rows.map((r) => ({
    id: r.story_id,
    photoUrl: r.photo_url,
    caption: r.caption,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    seenByMe: r.seen_by_me,
    viewsCount: r.views_count,
  }))
}

export const createStory = async (userId: string, url: string, caption: string) => {
  const [r] = await callFn<{ new_story_id: string }>('create_story', {
    p_user: userId,
    p_url: url,
    p_caption: caption,
  })
  return (await listStories(userId, userId)).find((s) => s.id === r.new_story_id)!
}

// true si existia y era del usuario
export const deleteStory = async (userId: string, storyId: string) => {
  const rows = await callFn<{ deleted_id: string }>('delete_story', { p_user: userId, p_story: storyId })
  return rows.length > 0
}

export const markStoryViewed = async (userId: string, storyId: string) => {
  const [r] = await callFn<{ marked: boolean }>('mark_story_viewed', { p_user: userId, p_story: storyId })
  return r?.marked ?? false
}

export const listStoryViewers = async (userId: string, storyId: string): Promise<StoryViewerInfo[]> => {
  const rows = await callFn<{
    viewer_id: string
    viewer_name: string
    viewer_photo: string | null
    viewed_at: string | Date
  }>('list_story_viewers', { p_user: userId, p_story: storyId })
  return rows.map((r) => ({
    id: r.viewer_id,
    name: r.viewer_name,
    photo: r.viewer_photo ?? '',
    viewedAt: iso(r.viewed_at),
  }))
}

// ---- Seguridad: bloquear, reportar, deshacer match ----

export type BlockedUser = { id: string; name: string; photo: string; blockedAt: string }

export const isBlockedBetween = async (a: string, b: string) => {
  const [r] = await callFn<{ is_blocked: boolean }>('blocked_between', { p_a: a, p_b: b })
  return r?.is_blocked === true
}

// false = el usuario a bloquear no existe
export const blockUser = async (userId: string, targetId: string) => {
  const [r] = await callFn<{ ok: boolean }>('block_user', { p_blocker: userId, p_blocked: targetId })
  return r?.ok === true
}

export const unblockUser = async (userId: string, targetId: string) => {
  const [r] = await callFn<{ ok: boolean }>('unblock_user', { p_blocker: userId, p_blocked: targetId })
  return r?.ok === true
}

export const listBlocked = async (userId: string): Promise<BlockedUser[]> => {
  const rows = await callFn<{
    blocked_user: string
    blocked_name: string
    blocked_photo: string | null
    blocked_at: string | Date
  }>('list_blocked', { p_user: userId })
  return rows.map((r) => ({
    id: r.blocked_user,
    name: r.blocked_name,
    photo: r.blocked_photo ?? '',
    blockedAt: iso(r.blocked_at),
  }))
}

export const unmatch = async (userId: string, conversationId: string) => {
  const [r] = await callFn<{ ok: boolean }>('unmatch', { p_user: userId, p_conversation: conversationId })
  return r?.ok === true
}

export type ReportInput = {
  reportedUserId: string
  type: 'profile' | 'photo' | 'comment' | 'story' | 'chat'
  targetId: string | null
  reason: 'inappropriate' | 'harassment' | 'spam' | 'fake' | 'other'
  details: string
  context: unknown
}

// null = el reportado no existe
export const createReport = async (reporterId: string, input: ReportInput) => {
  const [r] = await callFn<{ new_report_id: string }>('create_report', {
    p_reporter: reporterId,
    p_reported: input.reportedUserId,
    p_type: input.type,
    p_target: input.targetId,
    p_reason: input.reason,
    p_details: input.details,
    p_context: JSON.stringify(input.context),
  })
  return r?.new_report_id ?? null
}

// Descubrir no expone ids de usuario: reportes y bloqueos pueden venir con el id de perfil
export const userIdForProfile = async (profileId: string) => {
  if (useLocal) {
    const db = await localDb()
    const { rows } = await db.query<{ user_id: string }>('select user_id from profiles where id = $1', [profileId])
    return rows[0]?.user_id ?? null
  }
  const { data, error } = await supabaseServer().from('profiles').select('user_id').eq('id', profileId).maybeSingle()
  if (error) throw error
  return (data?.user_id as string | undefined) ?? null
}

// ---- Notificaciones push (una suscripcion por dispositivo) ----

// Guarda la suscripcion de un dispositivo; si ya era de otra cuenta, pasa a esta. Lanza si tiene forma invalida.
export const savePushSubscription = async (userId: string, subscription: PushSubscriptionJson, userAgent: string | null) => {
  await callFn('save_push_subscription', {
    p_user: userId,
    p_subscription: JSON.stringify(subscription),
    p_user_agent: userAgent,
  })
}

export const deletePushSubscription = async (userId: string, endpoint: string) => {
  const [r] = await callFn<{ out_ok: boolean }>('delete_push_subscription', { p_user: userId, p_endpoint: endpoint })
  return r?.out_ok === true
}

export const deletePushSubscriptions = async (userId: string) => {
  const [r] = await callFn<{ out_count: number }>('delete_push_subscriptions', { p_user: userId })
  return r?.out_count ?? 0
}

export const listPushSubscriptions = async (userId: string): Promise<PushSubscriptionJson[]> =>
  (await callFn<{ out_subscription: PushSubscriptionJson }>('list_push_subscriptions', { p_user: userId })).map(
    (r) => r.out_subscription
  )

export const dropPushEndpoint = async (endpoint: string) => {
  await callFn('drop_push_endpoint', { p_endpoint: endpoint })
}
