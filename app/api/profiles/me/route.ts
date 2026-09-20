import { getAuth, unauthorized } from '@/lib/api-auth'
import { getUserContext } from '@/lib/db'

export async function GET(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  try {
    const ctx = await getUserContext(auth.userId)
    if (!ctx) return unauthorized() // token de un usuario que ya no existe

    return Response.json({ profile: ctx.profile, guestName: ctx.guestName })
  } catch (error) {
    console.error('profiles/me error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
