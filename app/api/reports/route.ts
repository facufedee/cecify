import { getAuth, unauthorized } from '@/lib/api-auth'
import {
  createReport,
  getAuthor,
  getMessages,
  listComments,
  listConversations,
  listPhotos,
  listStories,
  type ReportInput,
  userIdForProfile,
} from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validators'

const TYPES = ['profile', 'photo', 'comment', 'story', 'chat'] as const
const REASONS = ['inappropriate', 'harassment', 'spam', 'fake', 'other'] as const
const DETAILS_MAX = 300

const invalid = (error: string, status = 400) => Response.json({ error }, { status })

// Reporta a un invitado. El servidor guarda una COPIA de lo reportado (no confia en lo que mande el
// cliente), asi el admin lo ve aunque despues se borre el mensaje, la foto o la historia.
export async function POST(req: Request) {
  const auth = await getAuth(req)
  if (!auth) return unauthorized()

  // Limite holgado para cualquier pedido (validaciones incluidas); el estricto va solo a los que se guardan
  if (!rateLimit(`report-attempt:${auth.userId}`, 60, 60_000).ok) {
    return invalid('Demasiadas solicitudes', 429)
  }

  let body: Record<string, unknown>
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>
  } catch {
    return invalid('Body inválido')
  }

  const { type, reason, targetId, conversationId, photoId } = body
  const details = typeof body.details === 'string' ? body.details.trim() : ''

  // El invitado viene por id de usuario o (desde Descubrir) por id de perfil
  let reportedUserId: unknown = body.reportedUserId
  if (!reportedUserId && isUuid(body.reportedProfileId)) {
    try {
      reportedUserId = await userIdForProfile(body.reportedProfileId)
    } catch {
      return Response.json({ error: 'Error del servidor' }, { status: 500 })
    }
  }
  if (!isUuid(reportedUserId)) return invalid('Invitado inválido')
  if (reportedUserId === auth.userId) return invalid('No podés reportarte a vos mismo')
  if (!TYPES.includes(type as (typeof TYPES)[number])) return invalid('Tipo de reporte inválido')
  if (!REASONS.includes(reason as (typeof REASONS)[number])) return invalid('Elegí un motivo')
  if (details.length > DETAILS_MAX) return invalid(`El detalle admite hasta ${DETAILS_MAX} caracteres`)

  try {
    let context: unknown = null
    let target: string | null = null

    switch (type as ReportInput['type']) {
      case 'profile': {
        const author = await getAuthor(reportedUserId)
        if (!author) return invalid('Invitado no encontrado', 404)
        context = author
        break
      }
      case 'chat': {
        if (!isUuid(conversationId)) return invalid('Conversación inválida')
        const conv = (await listConversations(auth.userId)).find((c) => c.id === conversationId)
        if (!conv || conv.other.userId !== reportedUserId) return invalid('Conversación no encontrada', 404)
        const messages = await getMessages(auth.userId, conversationId, { limit: 20 })
        target = conversationId
        context = {
          messages: messages.map((m) => ({
            from: m.fromUserId === auth.userId ? 'quien reporta' : 'reportado',
            content: m.content,
            at: m.createdAt,
          })),
        }
        break
      }
      case 'photo': {
        if (!isUuid(targetId)) return invalid('Foto inválida')
        const photo = (await listPhotos(auth.userId, { photo: targetId }))[0]
        if (!photo || photo.authorId !== reportedUserId) return invalid('Foto no encontrada', 404)
        target = targetId
        context = { photoUrl: photo.photoUrl, caption: photo.caption }
        break
      }
      case 'story': {
        if (!isUuid(targetId)) return invalid('Historia inválida')
        const story = (await listStories(auth.userId, reportedUserId)).find((s) => s.id === targetId)
        if (!story) return invalid('Historia no encontrada', 404)
        target = targetId
        context = { photoUrl: story.photoUrl, caption: story.caption }
        break
      }
      case 'comment': {
        if (!isUuid(targetId) || !isUuid(photoId)) return invalid('Comentario inválido')
        const comment = (await listComments(auth.userId, photoId)).find((c) => c.id === targetId)
        if (!comment || comment.authorId !== reportedUserId) return invalid('Comentario no encontrado', 404)
        target = targetId
        context = { photoId, body: comment.body }
        break
      }
    }

    if (!rateLimit(`report:${auth.userId}`, 5, 10 * 60_000).ok) {
      return invalid('Ya enviaste varios reportes, esperá unos minutos', 429)
    }

    const id = await createReport(auth.userId, {
      reportedUserId,
      type: type as ReportInput['type'],
      targetId: target,
      reason: reason as ReportInput['reason'],
      details,
      context,
    })
    if (!id) return invalid('Invitado no encontrado', 404)
    return Response.json({ ok: true })
  } catch (error) {
    console.error('reports/create error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
