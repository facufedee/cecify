import { createClient } from '@supabase/supabase-js'

// Cliente de Supabase con la service role. SOLO para el servidor (API routes): la app no usa
// Supabase desde el navegador y las tablas tienen RLS sin policies, asi que la clave publica no
// puede leer ni escribir nada. Nunca importar este modulo desde un componente cliente.
//
// Sin efectos al importar: falla recien al usarlo, con un mensaje que dice que falta.
export const supabaseServer = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (o usá LOCAL_DB=1 en desarrollo)')
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
