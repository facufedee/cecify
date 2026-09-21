// Cableado real de las notificaciones push: web-push + la base. Solo servidor.
import webpush from 'web-push'
import { dropPushEndpoint, listPushSubscriptions } from '@/lib/db'
import { createPushSender } from '@/lib/push'

const publicKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const privateKey = () => process.env.VAPID_PRIVATE_KEY
const subject = () => process.env.VAPID_SUBJECT

// Sin las tres variables las notificaciones quedan apagadas (la app funciona igual)
export const pushConfigured = () => Boolean(publicKey() && privateKey() && subject())

let ready = false
const init = () => {
  if (ready) return
  webpush.setVapidDetails(subject()!, publicKey()!, privateKey()!)
  ready = true
}

const TTL_SECONDS = 2 * 60 * 60 // si el dispositivo esta apagado mas de 2 h, el aviso ya no sirve

export const sendPush = createPushSender({
  get configured() {
    return pushConfigured()
  },
  list: listPushSubscriptions,
  drop: dropPushEndpoint,
  send: async (subscription, body) => {
    init()
    await webpush.sendNotification(subscription, body, { TTL: TTL_SECONDS, urgency: 'high' })
  },
})
