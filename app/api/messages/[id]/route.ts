import { getAuth, unauthorized } from '@/lib/api-auth'
import { getMessages, getReadState, listConversations } from '@/lib/db'
import { UUID_RE } from '@/lib/validators'

const PAGE_SIZE = 50

const parseDate = (v: string | null) => {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// Mensajes de una conversacion + datos de la otra persona (incluye su contacto: ya hay match).
// ?after=<iso> devuelve solo los nuevos (polling); ?before=<iso> pagina hacia atras.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ error: 'Conversación inválida' }, { status: 400 })

  const url = new URL(req.url)
  const after = parseDate(url.searchParams.get('after'))
  const before = parseDate(url.searchParams.get('before'))

  try {
    const conversation = (await listConversations(auth.userId)).find((c) => c.id === id)
    if (!conversation) return Response.json({ error: 'Conversación no encontrada' }, { status: 404 })

    const [messages, readUpTo] = await Promise.all([
      getMessages(auth.userId, id, { after, before, limit: PAGE_SIZE }),
      getReadState(auth.userId, id),
    ])
    // readUpTo: hasta cuando leyo la otra persona lo que enviaste (para el "Visto")
    return Response.json({ conversation, messages, readUpTo, pageSize: PAGE_SIZE })
  } catch (error) {
    console.error('messages/get error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
