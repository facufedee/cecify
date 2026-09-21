'use client'

export const TOKEN_KEY = 'cecify_token'

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

// Solo para la UI (saber cuales mensajes son mios). No es una verificacion: el servidor valida el JWT.
export const getSessionUserId = () => {
  const token = getToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.userId === 'string' ? (payload.userId as string) : null
  } catch {
    return null
  }
}

export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

export const setToken = (token: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {}
}

// Segundos que le quedan al token (solo para la UI; el servidor es quien manda). null si no hay o no se lee.
export const tokenSecondsLeft = () => {
  const token = getToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp - Math.floor(Date.now() / 1000) : null
  } catch {
    return null
  }
}

// Se renueva cuando faltan menos de 8 h de las 12 h del token: quien usa la app durante la fiesta no se
// queda afuera a mitad de la noche. Una sesion revocada o vencida (401) manda a /login (lo hace authFetch).
const REFRESH_WHEN_LEFT_SECONDS = 8 * 60 * 60
let refreshing: Promise<void> | null = null

export const refreshSessionIfNeeded = (): Promise<void> => {
  const left = tokenSecondsLeft()
  if (left === null || left > REFRESH_WHEN_LEFT_SECONDS) return Promise.resolve()
  if (refreshing) return refreshing

  refreshing = (async () => {
    try {
      const res = await authFetch('/api/auth/refresh', { method: 'POST' })
      if (res.ok) {
        const { token } = (await res.json()) as { token?: string }
        if (token) setToken(token)
      }
    } catch {
      // sin conexion: se reintenta en el proximo ciclo
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

// fetch con el JWT; si el token no sirve (401) limpia la sesion y manda a /login
export const authFetch = async (input: string, init: RequestInit = {}) => {
  const token = getToken()
  const res = await fetch(input, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  if (res.status === 401) {
    clearToken()
    // navegacion completa a proposito: resetea el estado en memoria de la sesion vencida
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login'
  }
  return res
}
