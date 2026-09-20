// Textos en espanol del panel de administracion (sin dependencias: cliente y servidor)
import { ROLE_LABELS, type Role } from '@/lib/roles'

export const REASON_LABELS: Record<string, string> = {
  inappropriate: 'Contenido inapropiado',
  harassment: 'Acoso o mensajes molestos',
  spam: 'Spam',
  fake: 'Perfil falso',
  other: 'Otro motivo',
}

export const TYPE_LABELS: Record<string, string> = {
  profile: 'Perfil',
  photo: 'Foto',
  comment: 'Comentario',
  story: 'Historia',
  chat: 'Conversación',
}

export const STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  reviewed: 'Revisado',
  dismissed: 'Descartado',
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

// Frase para el registro de acciones: "cambió el rol a Administrador"
export const describeAction = (action: string, details: Record<string, unknown> | null) => {
  const d = details ?? {}
  switch (action) {
    case 'set_role':
      return `cambió un rol a ${ROLE_LABELS[str(d.to) as Role] ?? str(d.to)}`
    case 'guest_add':
      return `agregó al invitado ${str(d.email)}`
    case 'guest_new_code':
      return 'generó un código nuevo para un invitado'
    case 'guest_delete':
      return `eliminó al invitado ${str(d.name) || str(d.email)}`
    case 'report_reviewed':
      return 'marcó un reporte como revisado'
    case 'report_dismissed':
      return 'descartó un reporte'
    case 'report_open':
      return 'reabrió un reporte'
    case 'photo_delete':
      return 'borró una foto del muro'
    case 'comment_delete':
      return 'borró un comentario'
    case 'story_delete':
      return 'borró una historia'
    default:
      return action
  }
}
