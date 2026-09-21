// SOLO DESARROLLO (LOCAL_DB=1): atajos para probar sin dos personas reales. Contra Supabase no hacen nada
// (o, en el caso de resetProfile, fallan a proposito).
import { localDb, useLocal } from '@/lib/db/core'

// Los invitados demo impares (demo1, demo3, demo5) le dan like de vuelta a quien les da like,
// para poder ver la pantalla de match.
export const demoLikeBack = async (demoUserId: string, toUserId: string) => {
  if (!useLocal) return
  const db = await localDb()
  const { rows } = await db.query<{ email: string }>('select email from users where id = $1', [demoUserId])
  const n = rows[0]?.email.match(/^demo(\d+)@demo\.cecify\.local$/)?.[1]
  if (n && Number(n) % 2 === 1) {
    await db.query(
      `insert into swipes (from_user_id, to_user_id, action) values ($1, $2, 'like') on conflict do nothing`,
      [demoUserId, toUserId]
    )
  }
}

// Si el usuario es un invitado demo, para responderle solo en el chat
export const isDemoUser = async (userId: string) => {
  if (!useLocal) return false
  const db = await localDb()
  const { rows } = await db.query<{ ok: boolean }>(
    "select email like 'demo%@demo.cecify.local' as ok from users where id = $1",
    [userId]
  )
  return rows[0]?.ok === true
}

// Usado por /api/dev/reset-profile
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
