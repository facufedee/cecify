// Unica puerta a la base de datos. Toda la logica vive en funciones SQL (supabase/migrations); desde aca solo
// se las llama. En produccion van por supabase.rpc; en desarrollo (LOCAL_DB=1) por Postgres embebido (PGlite),
// que aplica las mismas migraciones.
import { supabaseServer } from '@/lib/supabase'

// Solo en desarrollo: nunca se usa la base local en produccion
export const useLocal = process.env.LOCAL_DB === '1' && process.env.NODE_ENV !== 'production'

export const localDb = async () => (await import('@/lib/db/local')).getLocalDb()

// Llama una funcion SQL con argumentos con nombre. `fn` y las claves de `args` son constantes internas,
// nunca input del usuario. Los valores JSONB se pasan como objetos/arrays (no como texto ya serializado).
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
