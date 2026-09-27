import { getAuth, unauthorized } from '@/lib/api-auth'
import { getUserContext } from '@/lib/db'
import { phoneFromEventEmail } from '@/lib/event'

export async function GET(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  try {
    const ctx = await getUserContext(auth.userId)
    if (!ctx) return unauthorized() // token de un usuario que ya no existe

    return Response.json({
      profile: ctx.profile,
      guestName: ctx.guestName,
      guestSide: ctx.guestSide, // lo que cargo el admin, para precargar el onboarding
      guestPhone: phoneFromEventEmail(ctx.email), // entro con el QR de la fiesta: su WhatsApp para el contacto
      role: ctx.role,
      matchesCount: ctx.matchesCount,
    })
  } catch (error) {
    console.error('profiles/me error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
