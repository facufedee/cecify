// Pasar la sesion del navegador a la app instalada (codigos de un solo uso; se guarda solo el hash)
import { callFn, iso } from '@/lib/db/core'
import type { Role } from '@/lib/roles'

// null = el usuario ya no existe
export const createSessionTransfer = async (userId: string, codeHash: string, sessionStart: number, ttlSeconds: number) => {
  const [r] = await callFn<{ out_expires: string | Date }>('create_session_transfer', {
    p_user: userId,
    p_hash: codeHash,
    p_session_start: sessionStart,
    p_ttl_seconds: ttlSeconds,
  })
  return r ? iso(r.out_expires) : null
}

// null = no existe, ya se uso, vencio o la persona cerro sus sesiones
export const redeemSessionTransfer = async (codeHash: string) => {
  const [r] = await callFn<{ out_user: string; out_role: Role; out_version: number; out_session_start: string | number }>(
    'redeem_session_transfer',
    { p_hash: codeHash }
  )
  return r
    ? { userId: r.out_user, role: r.out_role, sessionVersion: r.out_version, sessionStart: Number(r.out_session_start) }
    : null
}
