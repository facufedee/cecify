// Notificaciones push (una suscripcion por dispositivo)
import type { PushSubscriptionJson } from '@/lib/push'
import { callFn } from '@/lib/db/core'

// Guarda la suscripcion de un dispositivo; si ya era de otra cuenta, pasa a esta. Lanza si tiene forma invalida.
export const savePushSubscription = async (userId: string, subscription: PushSubscriptionJson, userAgent: string | null) => {
  await callFn('save_push_subscription', {
    p_user: userId,
    p_subscription: subscription,
    p_user_agent: userAgent,
  })
}

export const deletePushSubscription = async (userId: string, endpoint: string) => {
  const [r] = await callFn<{ out_ok: boolean }>('delete_push_subscription', { p_user: userId, p_endpoint: endpoint })
  return r?.out_ok === true
}

export const deletePushSubscriptions = async (userId: string) => {
  const [r] = await callFn<{ out_count: number }>('delete_push_subscriptions', { p_user: userId })
  return r?.out_count ?? 0
}

export const listPushSubscriptions = async (userId: string): Promise<PushSubscriptionJson[]> =>
  (await callFn<{ out_subscription: PushSubscriptionJson }>('list_push_subscriptions', { p_user: userId })).map(
    (r) => r.out_subscription
  )

export const dropPushEndpoint = async (endpoint: string) => {
  await callFn('drop_push_endpoint', { p_endpoint: endpoint })
}
