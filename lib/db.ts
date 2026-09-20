import { supabaseServer } from '@/lib/supabase'

export type DbUser = { id: string; email: string; role: 'guest' | 'admin' }

// Solo en desarrollo: nunca se usa la base local en produccion
const useLocal = process.env.LOCAL_DB === '1' && process.env.NODE_ENV !== 'production'

export const findGuest = async (email: string, code: string) => {
  if (useLocal) {
    const { getLocalDb } = await import('@/lib/db-local')
    const db = await getLocalDb()
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
    const { getLocalDb } = await import('@/lib/db-local')
    const db = await getLocalDb()
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
