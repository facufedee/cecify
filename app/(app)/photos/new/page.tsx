'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, X } from 'lucide-react'
import StoryRing from '@/components/wall/StoryRing'
import { authFetch, compressImage } from '@/lib/client-auth'

const CAPTION_MAX = 300

export default function NewPostPage() {
  const router = useRouter()
  const [uploaded, setUploaded] = useState<{ url: string; preview: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [caption, setCaption] = useState('')
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [myPhoto, setMyPhoto] = useState('')

  useEffect(() => {
    authFetch('/api/profiles/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMyPhoto(data?.profile?.mainPhotoUrl ?? ''))
      .catch(() => {})
  }, [])

  const onFile = async (file: File) => {
    setError(null)
    setUploading(true)
    try {
      const blob = await compressImage(file)
      const form = new FormData()
      form.append('file', blob, 'photo.jpg')
      const res = await authFetch('/api/profiles/photo', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo subir la foto')
      setUploaded({ url: data.url, preview: URL.createObjectURL(blob) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir la foto')
    } finally {
      setUploading(false)
    }
  }

  const share = async () => {
    if (!uploaded || sharing) return
    setSharing(true)
    setError(null)
    try {
      const res = await authFetch('/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: uploaded.url, caption }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo publicar')
      router.replace('/photos')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo publicar')
      setSharing(false)
    }
  }

  return (
    <div className="flex h-full flex-col font-ig text-ig-text">
      <header className="flex items-center justify-between border-b border-ig-soft px-4 py-3">
        <button type="button" onClick={() => router.back()} aria-label="Cerrar" className="p-1">
          <X size={26} />
        </button>
        <h1 className="text-base font-semibold">Nueva publicación</h1>
        <button
          type="button"
          onClick={share}
          disabled={!uploaded || uploading || sharing}
          className="min-w-[4.5rem] text-right text-sm font-semibold text-ig-link disabled:opacity-40"
        >
          {sharing ? <Loader2 size={18} className="ml-auto animate-spin" /> : 'Compartir'}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <label className="relative block cursor-pointer border-b border-ig-soft bg-ig-soft">
          {uploaded ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploaded.preview} alt="Vista previa" className="aspect-[4/5] w-full object-cover" />
          ) : (
            <span className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 text-ig-muted">
              {uploading ? (
                <Loader2 size={36} className="animate-spin" />
              ) : (
                <>
                  <Camera size={48} strokeWidth={1.25} />
                  <span className="rounded-lg bg-ig-link px-4 py-2 text-sm font-semibold text-white">
                    Seleccionar de la galería
                  </span>
                </>
              )}
            </span>
          )}

          {uploaded && uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <Loader2 size={32} className="animate-spin" />
            </span>
          )}
          {uploaded && !uploading && (
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3.5 py-1.5 text-xs font-semibold text-white">
              Cambiar foto
            </span>
          )}

          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void onFile(file)
            }}
          />
        </label>

        <div className="flex gap-3 px-4 py-4">
          <StoryRing src={myPhoto} size={36} ring={false} />
          <div className="min-w-0 flex-1">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={CAPTION_MAX}
              rows={4}
              placeholder="Escribe un epígrafe..."
              aria-label="Epígrafe"
              className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-ig-muted"
            />
            <p className="text-right text-xs text-ig-muted">
              {caption.length}/{CAPTION_MAX}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="px-4 pb-4 text-center text-sm text-ig-like">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
