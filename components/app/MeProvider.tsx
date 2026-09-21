'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authFetch, refreshSessionIfNeeded } from '@/lib/client-auth'
import type { Profile } from '@/lib/profile-schema'
import type { Role } from '@/lib/roles'

export type Me = {
  profile: Profile | null
  role: Role
  matchesCount: number
}

type MeContextValue = {
  me: Me | null
  // Vuelve a pedir los datos (p. ej. despues de editar el perfil)
  reload: () => Promise<void>
}

const MeContext = createContext<MeContextValue>({ me: null, reload: async () => {} })

export const useMe = () => useContext(MeContext)

// Datos de quien esta usando la app: la navegacion se adapta a su rol y su modo (match o solo muro)
export default function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)

  const fetchMe = useCallback(async (): Promise<Me | null> => {
    try {
      const res = await authFetch('/api/profiles/me')
      if (!res.ok) return null
      const data = await res.json()
      return { profile: data.profile, role: data.role, matchesCount: data.matchesCount ?? 0 }
    } catch {
      return null // sin conexion: se queda con lo que habia
    }
  }, [])

  const reload = useCallback(async () => {
    const next = await fetchMe()
    if (next) setMe(next)
  }, [fetchMe])

  useEffect(() => {
    let cancelled = false
    fetchMe().then((next) => {
      if (next && !cancelled) setMe(next)
    })
    return () => {
      cancelled = true
    }
  }, [fetchMe])

  // Renueva la sesion mientras la app esta abierta: al entrar, al volver a la pestana y cada 15 minutos
  useEffect(() => {
    void refreshSessionIfNeeded()
    const onVisible = () => document.visibilityState === 'visible' && void refreshSessionIfNeeded()
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => void refreshSessionIfNeeded(), 15 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [])

  const value = useMemo(() => ({ me, reload }), [me, reload])
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>
}
