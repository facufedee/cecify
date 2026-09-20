import { rm } from 'node:fs/promises'
import path from 'node:path'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { resetProfile } from '@/lib/db'

// Solo desarrollo con LOCAL_DB=1: borra el perfil propio (y sus swipes/matches) para repetir el
// onboarding. Con ?only=swipes conserva el perfil y borra solo swipes y matches.
export async function POST(req: Request) {
  if (process.env.LOCAL_DB !== '1' || process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 })
  }

  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const only = new URL(req.url).searchParams.get('only') === 'swipes' ? 'swipes' : undefined
  await resetProfile(auth.userId, only)
  if (!only) {
    await rm(path.join(process.cwd(), 'public', 'uploads', auth.userId), {
      recursive: true,
      force: true,
    })
  }
  return Response.json({ ok: true })
}
