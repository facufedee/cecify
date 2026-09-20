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

// Achica y recomprime en el navegador antes de subir (fotos de celular pesan 5-10MB)
export const compressImage = async (file: File, maxSide = 1600, quality = 0.82) => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la foto'))),
      'image/jpeg',
      quality
    )
  )
}
