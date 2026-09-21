'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, X } from 'lucide-react'
import PhotoEditor from '@/components/photo/PhotoEditor'
import StoryImage from '@/components/stories/StoryImage'
import { authFetch } from '@/lib/client-auth'
import { STORY_ASPECTS, uploadPhoto } from '@/lib/client-photo'

const CAPTION_MAX = 150

export default function NewStoryPage() {
  const router = useRouter()
  const [uploaded, setUploaded] = useState<{ url: string; preview: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [caption, setCaption] = useState('')
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<File | null>(null) // foto que se esta encuadrando
  const [sourceFile, setSourceFile] = useState<File | null>(null) // la original, para volver a editarla

  // Al elegir una foto se abre el editor; al terminar se sube ya recortada
  const onFile = (file: File) => {
    setError(null)
    setSourceFile(file)
    setEditing(file)
  }

  const onEdited = async (blob: Blob) => {
    setEditing(null)
    setUploading(true)
    try {
      const url = await uploadPhoto(blob, 'story.jpg')
      setUploaded({ url, preview: URL.createObjectURL(blob) })
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
      const res = await authFetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: uploaded.url, caption }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo publicar la historia')
      router.replace('/photos')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo publicar la historia')
      setSharing(false)
    }
  }

  const picker = (
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
  )

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-black font-ig text-white">
      {uploaded && (
        <StoryImage src={uploaded.preview} alt="Vista previa de la historia" />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
      {uploaded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/70 to-transparent" />}

      <header className="relative z-10 flex items-center justify-between px-4 pt-4">
        <button type="button" onClick={() => router.back()} aria-label="Cerrar" className="p-1">
          <X size={28} />
        </button>
        {uploaded && (
          <div className="flex gap-2">
            {sourceFile && (
              <button
                type="button"
                onClick={() => setEditing(sourceFile)}
                disabled={uploading}
                className="rounded-full bg-black/45 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm disabled:opacity-50"
              >
                Editar
              </button>
            )}
            <label className="cursor-pointer rounded-full bg-black/45 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm">
              Cambiar foto
              {picker}
            </label>
          </div>
        )}
      </header>

      {!uploaded && (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          {uploading ? (
            <Loader2 size={40} className="animate-spin" />
          ) : (
            <>
              <Camera size={56} strokeWidth={1.25} />
              <h1 className="text-xl font-bold">Crea tu historia</h1>
              <p className="text-sm text-white/70">Se ve durante 24 horas para todos los invitados.</p>
              <label className="cursor-pointer rounded-lg bg-ig-link px-5 py-2.5 text-sm font-semibold">
                Seleccionar de la galería
                {picker}
              </label>
            </>
          )}
        </div>
      )}

      {uploaded && (
        <div className="relative z-10 mt-auto space-y-3 px-4 pb-5">
          {uploading && (
            <p className="flex items-center justify-center gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Subiendo…
            </p>
          )}
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={CAPTION_MAX}
            placeholder="Agrega texto…"
            aria-label="Texto de la historia"
            className="w-full rounded-full bg-black/45 px-4 py-3 text-center text-base font-semibold outline-none backdrop-blur-sm placeholder:text-white/60"
          />
          {error && (
            <p role="alert" className="text-center text-sm text-white">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={share}
            disabled={uploading || sharing}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-bold text-black disabled:opacity-50"
          >
            {sharing && <Loader2 size={16} className="animate-spin" />}
            Compartir en tu historia
          </button>
        </div>
      )}

      {editing && (
        <PhotoEditor
          file={editing}
          title="Encuadrá tu historia"
          aspects={STORY_ASPECTS}
          minLongSide={900}
          onCancel={() => setEditing(null)}
          onDone={onEdited}
        />
      )}

      {!uploaded && error && (
        <p role="alert" className="relative z-10 px-6 pb-6 text-center text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
