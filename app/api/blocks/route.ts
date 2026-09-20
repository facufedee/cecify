import { getAuth, unauthorized } from '@/lib/api-auth'
import { blockUser, listBlocked, userIdForProfile } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

export async function GET(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  try {
    return Response.json({ blocked: await listBlocked(auth.userId) })
  } catch (error) {
    console.error('blocks/list error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// Bloquea a un invitado: se deshace el match y dejan de verse en Descubrir, el muro y las historias
export async function POST(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`block:${auth.userId}`, 20, 60_000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 })
  }

  const input = (body ?? {}) as { userId?: unknown; profileId?: unknown }
  let userId: unknown = input.userId
  if (!userId && isUuid(input.profileId)) {
    try {
      userId = await userIdForProfile(input.profileId)
    } catch {
      return Response.json({ error: 'Error del servidor' }, { status: 500 })
    }
  }
  if (!isUuid(userId)) return Response.json({ error: 'Invitado inválido' }, { status: 400 })
  if (userId === auth.userId) {
    return Response.json({ error: 'No podés bloquearte a vos mismo' }, { status: 400 })
  }

  try {
    if (!(await blockUser(auth.userId, userId))) {
      return Response.json({ error: 'Invitado no encontrado' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    console.error('blocks/create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
