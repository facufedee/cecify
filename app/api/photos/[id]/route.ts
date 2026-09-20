import { getAuth, unauthorized } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { deletePhoto } from '@/lib/db'
import { UUID_RE } from '@/lib/validators'

// Solo el autor puede borrar su foto. (El archivo queda en el storage; ver notas del proyecto.)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  if (!rateLimit(`photo-delete:${auth.userId}`, 30, 60000).ok) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Foto inválida' }, { status: 400 })

  try {
    const url = await deletePhoto(auth.userId, id)
    if (!url) return Response.json({ error: 'Foto no encontrada' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    console.error('photos/delete error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
