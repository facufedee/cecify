import { adminOnly, badRequest, isUniqueViolation, serverError } from '@/lib/admin-api'
import { addGuest, importGuests } from '@/lib/admin-guests'
import { adminListGuests } from '@/lib/db-admin'
import { NAME_MAX, parseGuestsCsv, parseSide } from '@/lib/guests'
import { EMAIL_RE } from '@/lib/validators'

const PAGE = 50
const CSV_BYTES_MAX = 512 * 1024

// ?q=texto (busca por nombre o email) &offset=N
export async function GET(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const params = new URL(req.url).searchParams
  const q = (params.get('q') ?? '').slice(0, 100)
  const offset = Math.max(0, Number.parseInt(params.get('offset') ?? '0', 10) || 0)

  try {
    return Response.json({ ...(await adminListGuests(actor.userId, { search: q, limit: PAGE, offset })), pageSize: PAGE })
  } catch (error) {
    return serverError('admin/guests', error)
  }
}

// Alta de un invitado: { name, email, side? }  |  importacion: { csv: "name,email,code,side\n..." }
// Devuelve el codigo de cada invitado para poder enviarlo.
export async function POST(req: Request) {
  const actor = await adminOnly(req)
  if (actor instanceof Response) return actor

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Body inválido')

  try {
    if (typeof body.csv === 'string') {
      if (body.csv.length > CSV_BYTES_MAX) return badRequest('El archivo es demasiado grande')
      const parsed = parseGuestsCsv(body.csv)
      if (parsed.guests.length === 0) {
        return badRequest(parsed.errors[0]?.message ?? 'No hay invitados para importar')
      }
      const summary = await importGuests(actor.userId, parsed.guests)
      return Response.json({ ...summary, errors: parsed.errors })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!name || name.length > NAME_MAX) return badRequest('Nombre inválido')
    if (email.length > 255 || !EMAIL_RE.test(email)) return badRequest('Email inválido')
    const side = body.side === undefined ? undefined : parseSide(String(body.side))
    if (side === undefined && body.side !== undefined) return badRequest('Lado inválido')

    const saved = await addGuest(actor.userId, { name, email, side })
    if (!saved) return badRequest('No tenés permiso para esto', 403)
    return Response.json(saved, { status: saved.created ? 201 : 200 })
  } catch (error) {
    if (isUniqueViolation(error)) return badRequest('Uno de los códigos ya lo tiene otro invitado', 409)
    return serverError('admin/guests/post', error)
  }
}
