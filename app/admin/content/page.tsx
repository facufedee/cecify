'use client'

import { useEffect, useState } from 'react'
import { Eye, Heart, MessageCircle, Trash2 } from 'lucide-react'
import { btn, ConfirmDialog, EmptyState, ErrorNote, Modal, Spinner, useToast } from '@/components/admin/ui'
import { adminJson, errorMessage } from '@/lib/admin-client'
import type { AdminComment, AdminPhoto, AdminStory } from '@/lib/db/admin'
import { formatShortAgo } from '@/lib/format'

const PAGE = 24

// Tiempo que le queda a una historia: "vence en 5 h"
const expiresIn = (iso: string) => {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000))
  return minutes < 60 ? `vence en ${minutes} min` : `vence en ${Math.round(minutes / 60)} h`
}

function PhotoModal({
  photo,
  onClose,
  onDeleted,
  onCommentDeleted,
  notify,
}: {
  photo: AdminPhoto
  onClose: () => void
  onDeleted: () => void
  onCommentDeleted: () => void
  notify: (m: string) => void
}) {
  const [comments, setComments] = useState<AdminComment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'photo' | AdminComment | null>(null)

  useEffect(() => {
    let cancelled = false
    adminJson<{ comments: AdminComment[] }>(`/api/admin/content/photos/${photo.id}`)
      .then((d) => !cancelled && setComments(d.comments))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [photo.id])

  return (
    <Modal title={`Foto de ${photo.authorName}`} onClose={onClose} wide>
      <div className="grid gap-5 sm:grid-cols-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.photoUrl} alt={photo.caption ?? `Foto de ${photo.authorName}`} className="max-h-[60dvh] w-full rounded-lg bg-neutral-100 object-contain" />

        <div className="space-y-4 text-sm">
          <div>
            <p className="font-medium">{photo.authorName}</p>
            <p className="text-xs text-neutral-500">{formatShortAgo(photo.createdAt)}</p>
            {photo.caption && <p className="mt-2">{photo.caption}</p>}
            <p className="mt-2 flex items-center gap-4 text-neutral-500">
              <span className="flex items-center gap-1"><Heart size={14} /> {photo.likesCount}</span>
              <span className="flex items-center gap-1"><MessageCircle size={14} /> {photo.commentsCount}</span>
            </p>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Comentarios</h3>
            {error && <ErrorNote>{error}</ErrorNote>}
            {!comments && !error && <Spinner />}
            {comments?.length === 0 && <p className="text-neutral-500">Sin comentarios.</p>}
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {comments?.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2">
                  <p className="min-w-0 flex-1 break-words">
                    <span className="font-medium">{c.authorName}</span> {c.body}
                  </p>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-neutral-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Borrar el comentario de ${c.authorName}`}
                    onClick={() => setConfirm(c)}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <button type="button" className={btn.danger} onClick={() => setConfirm('photo')}>
            <Trash2 size={15} /> Borrar foto
          </button>
        </div>
      </div>

      {confirm === 'photo' && (
        <ConfirmDialog
          title="Borrar foto"
          message="Se borra del muro con sus comentarios y me gusta. No se puede deshacer."
          confirmLabel="Borrar foto"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await adminJson(`/api/admin/content/photos/${photo.id}`, { method: 'DELETE' })
            notify('Foto borrada')
            onDeleted()
          }}
        />
      )}
      {confirm && confirm !== 'photo' && (
        <ConfirmDialog
          title="Borrar comentario"
          message={<>“{confirm.body}” — {confirm.authorName}</>}
          confirmLabel="Borrar comentario"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await adminJson(`/api/admin/content/comments/${confirm.id}`, { method: 'DELETE' })
            setComments((prev) => prev?.filter((c) => c.id !== confirm.id) ?? null)
            onCommentDeleted()
            notify('Comentario borrado')
          }}
        />
      )}
    </Modal>
  )
}

function Photos({ notify }: { notify: (m: string) => void }) {
  const [photos, setPhotos] = useState<AdminPhoto[] | null>(null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<AdminPhoto | null>(null)

  useEffect(() => {
    let cancelled = false
    adminJson<{ photos: AdminPhoto[] }>('/api/admin/content/photos')
      .then((d) => {
        if (cancelled) return
        setPhotos(d.photos)
        setMore(d.photos.length === PAGE)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const loadMore = async () => {
    if (!photos?.length) return
    setLoadingMore(true)
    try {
      const before = encodeURIComponent(photos[photos.length - 1].createdAt)
      const d = await adminJson<{ photos: AdminPhoto[] }>(`/api/admin/content/photos?before=${before}`)
      setPhotos((prev) => [...(prev ?? []), ...d.photos])
      setMore(d.photos.length === PAGE)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoadingMore(false)
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!photos) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (photos.length === 0) return <EmptyState>Todavía no hay fotos en el muro.</EmptyState>

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              className="group block w-full overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:border-brand"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.photoUrl} alt={p.caption ?? `Foto de ${p.authorName}`} loading="lazy" className="aspect-square w-full bg-neutral-100 object-cover" />
              <span className="block px-3 py-2">
                <span className="block truncate text-sm font-medium">{p.authorName}</span>
                <span className="flex items-center gap-3 text-xs text-neutral-500">
                  <span className="flex items-center gap-1"><Heart size={12} /> {p.likesCount}</span>
                  <span className="flex items-center gap-1"><MessageCircle size={12} /> {p.commentsCount}</span>
                  <span className="ml-auto">{formatShortAgo(p.createdAt)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {more && (
        <div className="mt-5 flex justify-center">
          <button type="button" className={btn.secondary} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}

      {open && (
        <PhotoModal
          photo={open}
          onClose={() => setOpen(null)}
          notify={notify}
          onDeleted={() => {
            setPhotos((prev) => prev?.filter((p) => p.id !== open.id) ?? null)
            setOpen(null)
          }}
          onCommentDeleted={() =>
            setPhotos((prev) => prev?.map((p) => (p.id === open.id ? { ...p, commentsCount: Math.max(0, p.commentsCount - 1) } : p)) ?? null)
          }
        />
      )}
    </>
  )
}

function Stories({ notify }: { notify: (m: string) => void }) {
  const [stories, setStories] = useState<AdminStory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<AdminStory | null>(null)

  useEffect(() => {
    let cancelled = false
    adminJson<{ stories: AdminStory[] }>('/api/admin/content/stories')
      .then((d) => !cancelled && setStories(d.stories))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!stories) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (stories.length === 0) return <EmptyState>No hay historias activas ahora.</EmptyState>

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stories.map((s) => (
          <li key={s.id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.photoUrl} alt={s.caption ?? `Historia de ${s.authorName}`} loading="lazy" className="aspect-[9/16] w-full bg-neutral-100 object-cover" />
            <div className="space-y-1 px-3 py-2">
              <p className="truncate text-sm font-medium">{s.authorName}</p>
              {s.caption && <p className="line-clamp-2 text-xs text-neutral-600">{s.caption}</p>}
              <p className="flex items-center justify-between text-xs text-neutral-500">
                <span>{expiresIn(s.expiresAt)}</span>
                <span className="flex items-center gap-1"><Eye size={12} /> {s.viewsCount}</span>
              </p>
              <button type="button" className={`${btn.ghost} -ml-2 !text-red-600`} onClick={() => setConfirm(s)}>
                <Trash2 size={14} /> Borrar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {confirm && (
        <ConfirmDialog
          title="Borrar historia"
          message={`Se borra la historia de ${confirm.authorName} para todos. No se puede deshacer.`}
          confirmLabel="Borrar historia"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await adminJson(`/api/admin/content/stories/${confirm.id}`, { method: 'DELETE' })
            setStories((prev) => prev?.filter((s) => s.id !== confirm.id) ?? null)
            notify('Historia borrada')
          }}
        />
      )}
    </>
  )
}

export default function AdminContentPage() {
  const [tab, setTab] = useState<'photos' | 'stories'>('photos')
  const { show, toast } = useToast()

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Tipo de contenido" className="flex gap-2">
        {(
          [
            ['photos', 'Fotos del muro'],
            ['stories', 'Historias activas'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
              tab === value ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:border-brand'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'photos' ? <Photos notify={show} /> : <Stories notify={show} />}
      {toast}
    </div>
  )
}
