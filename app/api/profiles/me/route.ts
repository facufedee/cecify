import { getAuth, unauthorized } from '@/lib/api-auth'
import { getUserContext } from '@/lib/db'

export async function GET(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  try {
    const ctx = await getUserContext(auth.userId)
    if (!ctx) return unauthorized() // token de un usuario que ya no existe

    return Response.json({
      profile: ctx.profile,
      guestName: ctx.guestName,
      guestSide: ctx.guestSide, // lo que cargo el admin, para precargar el onboarding
      role: ctx.role,
      matchesCount: ctx.matchesCount,
    })
  } catch (error) {
    console.error('profiles/me error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
