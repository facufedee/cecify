'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'
import PhotoSlot from '@/components/onboarding/PhotoSlot'
import { authFetch, compressImage } from '@/lib/client-auth'
import {
  AGE_MAX,
  AGE_MIN,
  BIO_MAX,
  INTERESTS,
  MAX_EXTRA_PHOTOS,
  MAX_INTERESTS,
  NAME_MAX,
  type Profile,
} from '@/lib/profile-schema'

const field =
  'w-full border-b border-ig-border bg-transparent py-2 text-sm outline-none transition placeholder:text-ig-muted focus:border-ig-text'

export default function EditProfilePage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [bio, setBio] = useState('')
  // indice 0 = principal, 1..3 = adicionales; cada uno es la URL ya subida (o null)
  const [photos, setPhotos] = useState<(string | null)[]>(Array(1 + MAX_EXTRA_PHOTOS).fill(null))
  const [uploading, setUploading] = useState<number | null>(null)
  const [interests, setInterests] = useState<string[]>([])
  const [instagram, setInstagram] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    let cancelled = false
    authFetch('/api/profiles/me')
      .then(async (res) => {
        if (!res.ok || cancelled) return
        const { profile } = (await res.json()) as { profile: Profile | null }
        if (!profile) return router.replace('/onboarding')
        setName(profile.name)
        setAge(String(profile.age))
        setBio(profile.bio)
        setPhotos([profile.mainPhotoUrl, ...profile.additionalPhotos, ...Array(MAX_EXTRA_PHOTOS).fill(null)].slice(0, 1 + MAX_EXTRA_PHOTOS))
        setInterests(profile.interests)
        setInstagram(profile.contactMethods.instagram ?? '')
        setWhatsapp(profile.contactMethods.whatsapp ?? '')
        setVisible(profile.visible)
        setReady(true)
      })
      .catch(() => !cancelled && setError('No se pudo cargar tu perfil'))
    return () => {
      cancelled = true
    }
  }, [router])

  const onPhoto = async (index: number, file: File) => {
    setError(null)
    setUploading(index)
    try {
      const blob = await compressImage(file)
      const form = new FormData()
      form.append('file', blob, 'photo.jpg')
      const res = await authFetch('/api/profiles/photo', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo subir la foto')
      setPhotos((prev) => prev.map((p, i) => (i === index ? data.url : p)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir la foto')
    } finally {
      setUploading(null)
    }
  }

  const toggleInterest = (interest: string) =>
    setInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : prev.length < MAX_INTERESTS
          ? [...prev, interest]
          : prev
    )

  const ageNum = Number(age)
  const valid =
    name.trim().length > 0 &&
    Number.isInteger(ageNum) &&
    ageNum >= AGE_MIN &&
    ageNum <= AGE_MAX &&
    photos[0] !== null &&
    interests.length > 0 &&
    (instagram.trim() !== '' || whatsapp.trim() !== '') &&
    uploading === null

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await authFetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: ageNum,
          bio,
          mainPhotoUrl: photos[0],
          additionalPhotos: photos.slice(1).filter((p): p is string => p !== null),
          interests,
          contactMethods: { instagram, whatsapp },
          visible,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      router.replace('/profile')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
      setSaving(false)
    }
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        {error ? <p className="px-8 text-center text-sm text-ig-like">{error}</p> : <Loader2 className="animate-spin text-ig-muted" />}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col font-ig text-ig-text">
      <header className="flex items-center justify-between border-b border-ig-soft px-4 py-3">
        <button type="button" onClick={() => router.back()} aria-label="Cancelar" className="p-1">
          <X size={26} />
        </button>
        <h1 className="text-base font-semibold">Editar perfil</h1>
        <button
          type="button"
          onClick={save}
          disabled={!valid || saving}
          className="min-w-[3.5rem] text-right text-sm font-semibold text-ig-link disabled:opacity-40"
        >
          {saving ? <Loader2 size={18} className="ml-auto animate-spin" /> : 'Listo'}
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-6">
        <section className="flex flex-col items-center gap-4">
          <PhotoSlot main preview={photos[0]} uploading={uploading === 0} onFile={(f) => onPhoto(0, f)} />
          <div className="flex gap-3">
            {photos.slice(1).map((p, i) => (
              <PhotoSlot
                key={i}
                preview={p}
                uploading={uploading === i + 1}
                onFile={(f) => onPhoto(i + 1, f)}
                onRemove={() => setPhotos((prev) => prev.map((x, j) => (j === i + 1 ? null : x)))}
              />
            ))}
          </div>
        </section>

        <section className="space-y-5">
          <label className="block text-xs text-ig-muted">
            Nombre
            <input className={field} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-xs text-ig-muted">
            Edad
            <input
              className={field}
              type="number"
              inputMode="numeric"
              min={AGE_MIN}
              max={AGE_MAX}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>
          <label className="block text-xs text-ig-muted">
            <span className="flex justify-between">
              Sobre vos
              <span>
                {bio.length}/{BIO_MAX}
              </span>
            </span>
            <textarea
              className={`${field} resize-none`}
              rows={2}
              maxLength={BIO_MAX}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </label>
        </section>

        <section>
          <h2 className="mb-3 flex justify-between text-sm font-semibold">
            Intereses
            <span className="font-normal text-ig-muted">
              {interests.length}/{MAX_INTERESTS}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((interest) => {
              const on = interests.includes(interest)
              return (
                <button
                  key={interest}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleInterest(interest)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
                    on ? 'border-ig-text bg-ig-text text-white' : 'border-ig-border text-ig-text'
                  }`}
                >
                  {interest}
                </button>
              )
            })}
          </div>
        </section>

        <section className="space-y-5">
          <div>
            <h2 className="text-sm font-semibold">Contacto</h2>
            <p className="text-xs text-ig-muted">Solo lo ven las personas con las que hacés match. Completá al menos uno.</p>
          </div>
          <label className="block text-xs text-ig-muted">
            Instagram
            <input
              className={field}
              value={instagram}
              autoCapitalize="none"
              placeholder="@usuario"
              onChange={(e) => setInstagram(e.target.value)}
            />
          </label>
          <label className="block text-xs text-ig-muted">
            WhatsApp
            <input
              className={field}
              type="tel"
              inputMode="tel"
              value={whatsapp}
              placeholder="+54 9 11 ..."
              onChange={(e) => setWhatsapp(e.target.value)}
            />
          </label>
        </section>

        <section className="flex items-center justify-between gap-4 rounded-xl bg-ig-soft px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Aparecer en Descubrir</p>
            <p className="text-xs text-ig-muted">
              Si lo desactivás, nadie nuevo te ve al deslizar. Tus matches y tus fotos siguen igual.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={visible}
            aria-label="Aparecer en Descubrir"
            onClick={() => setVisible((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${visible ? 'bg-ig-link' : 'bg-ig-border'}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${visible ? 'left-[1.5rem]' : 'left-0.5'}`}
            />
          </button>
        </section>

        {error && (
          <p role="alert" className="text-center text-sm text-ig-like">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
