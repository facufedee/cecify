'use client'

import { authFetch } from '@/lib/client-auth'

// Sube una foto ya editada (recortada y achicada por el editor) y devuelve su URL.
// El servidor la vuelve a procesar (quita EXIF/GPS) pero no la recorta ni la agranda.
export const uploadPhoto = async (blob: Blob, name = 'photo.jpg'): Promise<string> => {
  const form = new FormData()
  form.append('file', blob, name)
  const res = await authFetch('/api/profiles/photo', { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'No se pudo subir la foto')
  return (data as { url: string }).url
}

// Formatos que ofrece el editor en cada lugar
export const STORY_ASPECTS = [
  { id: 'original', label: 'Original', aspect: 'original' as const },
  { id: 'full', label: 'Pantalla completa', aspect: 9 / 16 },
  { id: 'square', label: 'Cuadrada', aspect: 1 },
]
export const POST_ASPECTS = [
  { id: 'original', label: 'Original', aspect: 'original' as const },
  { id: 'square', label: 'Cuadrada', aspect: 1 },
  { id: 'portrait', label: 'Vertical 4:5', aspect: 4 / 5 },
]
// Las fotos de perfil se muestran siempre en 4:5 (tarjeta de Descubrir): se encuadran a ese formato
export const PROFILE_ASPECTS = [{ id: 'portrait', label: 'Perfil 4:5', aspect: 4 / 5 }]
