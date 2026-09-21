// Logica del envio de notificaciones push, sin dependencias de servidor (se inyectan) para poder probarla.
// El cableado real (web-push + base) esta en lib/push-server.ts.

export type PushPayload = {
  title: string
  body: string
  url: string // ruta dentro de la app a la que lleva la notificacion
  tag?: string // notificaciones con la misma etiqueta se reemplazan (una por conversacion)
}

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } }

const TITLE_MAX = 60
const BODY_MAX = 120

const cut = (s: string, max: number) => {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

// Lo que se manda por la red y se muestra en la pantalla bloqueada: acotado y con la ruta siempre interna
export const buildPayload = (p: PushPayload): PushPayload => ({
  title: cut(p.title, TITLE_MAX) || 'Cecify',
  body: cut(p.body, BODY_MAX),
  url: p.url.startsWith('/') && !p.url.startsWith('//') ? p.url : '/',
  ...(p.tag ? { tag: p.tag.slice(0, 64) } : {}),
})

// Un dispositivo dado de baja (el usuario revoco el permiso o desinstalo la app)
const isGone = (error: unknown) => {
  const code = (error as { statusCode?: number } | null)?.statusCode
  return code === 404 || code === 410
}

export type PushDeps = {
  configured: boolean
  list: (userId: string) => Promise<PushSubscriptionJson[]>
  drop: (endpoint: string) => Promise<void>
  send: (subscription: PushSubscriptionJson, body: string) => Promise<void>
}

export type PushResult = { sent: number; dropped: number; failed: number }

// Manda el aviso a todos los dispositivos de la persona. Nunca lanza: una notificacion que falla no
// tiene que romper el envio del mensaje ni el match que la origino.
export const createPushSender = (deps: PushDeps) => async (userId: string, payload: PushPayload): Promise<PushResult> => {
  const result: PushResult = { sent: 0, dropped: 0, failed: 0 }
  if (!deps.configured) return result

  try {
    const body = JSON.stringify(buildPayload(payload))
    const subs = await deps.list(userId)
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await deps.send(sub, body)
          result.sent++
        } catch (error) {
          if (isGone(error)) {
            result.dropped++
            await deps.drop(sub.endpoint).catch(() => {})
          } else {
            result.failed++
            console.warn('[push] no se pudo enviar:', (error as { statusCode?: number })?.statusCode ?? (error as Error)?.message)
          }
        }
      })
    )
  } catch (error) {
    console.warn('[push] error:', (error as Error)?.message)
  }
  return result
}
