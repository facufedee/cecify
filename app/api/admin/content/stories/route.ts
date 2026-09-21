import { adminOnly, serverError } from '@/lib/admin-api'
import { adminListStories } from '@/lib/db/admin'

// Historias activas (las de las ultimas 24 h)
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  try {
    return Response.json({ stories: await adminListStories(actor.userId) })
  } catch (error) {
    return serverError('admin/content/stories', error)
  }
}
