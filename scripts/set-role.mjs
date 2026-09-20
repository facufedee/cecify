// Uso: npm run set:role -- email@ejemplo.com superadmin
// Roles: guest | admin | superadmin. Sirve sobre todo para nombrar al primer superadmin
// (despues se puede hacer desde la app). La persona tiene que haber iniciado sesion al menos una vez.
import { createClient } from '@supabase/supabase-js'

const [email, role] = process.argv.slice(2)
if (!email || !['guest', 'admin', 'superadmin'].includes(role)) {
  console.error('Uso: npm run set:role -- email@ejemplo.com guest|admin|superadmin')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const { data, error } = await supabase
  .from('users')
  .update({ role })
  .eq('email', email.trim().toLowerCase())
  .select('email, role')

if (error) {
  console.error('No se pudo cambiar el rol:', error.message)
  process.exit(1)
}
if (!data.length) {
  console.error('No existe ese usuario: tiene que iniciar sesión al menos una vez en la app.')
  process.exit(1)
}
console.log(`${data[0].email} ahora es ${data[0].role}`)
