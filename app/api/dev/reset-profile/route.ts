import { rm } from 'node:fs/promises'
import path from 'node:path'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { resetProfile } from '@/lib/db'

// Solo desarrollo con LOCAL_DB=1: borra el perfil propio (y sus swipes/matches) para repetir el
// onboarding. Con ?only=swipes conserva el perfil y borra swipes, matches y vistas de historias;
// con ?only=story-views borra solo las historias vistas.
export async function POST(req: Request) {
  if (process.env.LOCAL_DB !== '1' || process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 })
  }

  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const param = new URL(req.url).searchParams.get('only')
  const only = param === 'swipes' || param === 'story-views' ? param : undefined
  await resetProfile(auth.userId, only)
  if (!only) {
    await rm(path.join(process.cwd(), 'public', 'uploads', auth.userId), {
      recursive: true,
      force: true,
    })
  }
  return Response.json({ ok: true })
}
