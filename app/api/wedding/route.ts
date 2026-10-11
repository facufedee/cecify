import { getAuth, unauthorized } from '@/lib/api-auth'
import { weddingOfUser } from '@/lib/db'
import { isAdminRole } from '@/lib/roles'

// El casamiento de quien tiene sesion: { partnerA, partnerB }. Los organizadores ademas reciben el codigo y el
// horario de registro: { code, opensAt, closesAt } (null = el registro nunca se abrio).
export async function GET(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  try {
    const wedding = await weddingOfUser(auth.userId)
    if (!wedding) return unauthorized() // la cuenta ya no existe
    const names = { partnerA: wedding.partnerA, partnerB: wedding.partnerB }
    if (!isAdminRole(auth.role)) return Response.json(names)
    return Response.json({ ...names, code: wedding.code, opensAt: wedding.opensAt, closesAt: wedding.closesAt })
  } catch (error) {
    console.error('wedding error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
