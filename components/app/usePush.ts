'use client'

import { useCallback, useEffect, useState } from 'react'
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push-client'

// Estado de las notificaciones de este dispositivo y las acciones para activarlas o apagarlas
export function usePush() {
  const [state, setState] = useState<PushState | null>(null) // null = todavia se esta comprobando
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPushState()
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState('unsupported'))
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setState(await enablePush())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron activar las notificaciones')
      setState(await getPushState().catch(() => 'off' as PushState))
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await disablePush()
      setState('off')
    } catch {
      setError('No se pudieron apagar las notificaciones')
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, busy, error, enable, disable }
}
