// Descubrir y swipes
import type { LookingFor, Side } from '@/lib/profile-schema'
import { callFn } from '@/lib/db/core'
import { demoLikeBack } from '@/lib/db/dev'
import { getProfileOwner } from '@/lib/db/profiles'

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
  const rows = await callFn<DiscoverRow>('discover_profiles', { p_user: userId, p_limit: limit, p_exclude: exclude })
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
  const target = await getProfileOwner(profileId)
  if (!target) return { status: 'not_found' }
  if (target.userId === fromUserId) return { status: 'self' }

  // SOLO DESARROLLO: algunos invitados demo le dan like de vuelta, para ver la pantalla de match
  if (action === 'like') await demoLikeBack(target.userId, fromUserId)

  const [row] = await callFn<SwipeRow>('record_swipe', { p_from: fromUserId, p_to: target.userId, p_action: action })

  let conversationId: string | null = null
  if (row.matched && row.match_row_id) {
    const [c] = await callFn<{ out_id: string }>('conversation_for_match', { p_match: row.match_row_id })
    conversationId = c?.out_id ?? null
  }

  return {
    status: 'ok',
    matched: row.matched,
    matchId: row.match_row_id,
    conversationId,
    duplicate: row.was_duplicate,
    target,
  }
}
