import { getAuth, unauthorized } from '@/lib/api-auth'
import { deletePhoto } from '@/lib/db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Solo el autor puede borrar su foto. (El archivo queda en el storage; ver notas del proyecto.)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

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
