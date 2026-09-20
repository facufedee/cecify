'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Loader2 } from 'lucide-react'
import StepIndicator from '@/components/onboarding/StepIndicator'
import PhotoSlot from '@/components/onboarding/PhotoSlot'
import { authFetch, compressImage, getToken } from '@/lib/client-auth'
import {
  AGE_MAX,
  AGE_MIN,
  BIO_MAX,
  INTERESTS,
  MAX_EXTRA_PHOTOS,
  MAX_INTERESTS,
  NAME_MAX,
} from '@/lib/profile-schema'

type Photo = { url: string; preview: string } | null

const TITLES = ['Contanos sobre vos', 'Subí tus fotos', 'Tus intereses y contacto']

const inputClass =
  'w-full rounded-xl bg-cream px-4 py-3 text-sm text-neutral-800 outline-none ring-1 ring-transparent transition placeholder:text-neutral-400 focus:bg-white focus:ring-brand'

export default function OnboardingPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [bio, setBio] = useState('')
  // indice 0 = foto principal, 1..3 = adicionales
  const [photos, setPhotos] = useState<Photo[]>(Array(1 + MAX_EXTRA_PHOTOS).fill(null))
  const [uploading, setUploading] = useState<number | null>(null)
  const [interests, setInterests] = useState<string[]>([])
  const [instagram, setInstagram] = useState('')
  const [whatsapp, setWhatsapp] = useState('')

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    authFetch('/api/profiles/me')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (data.profile) {
          router.replace('/discover')
          return
        }
        if (data.guestName) setName(data.guestName)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [router])

  const ageNum = Number(age)
  const stepValid = [
    name.trim().length > 0 && Number.isInteger(ageNum) && ageNum >= AGE_MIN && ageNum <= AGE_MAX,
    photos[0] !== null && uploading === null,
    interests.length > 0 && (instagram.trim() !== '' || whatsapp.trim() !== ''),
  ][step - 1]

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
      setPhotos((prev) => prev.map((p, i) => (i === index ? { url: data.url, preview: URL.createObjectURL(blob) } : p)))
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

  const submit = async () => {
    setError(null)
    setSaving(true)
    try {
      const res = await authFetch('/api/profiles/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: ageNum,
          bio,
          mainPhotoUrl: photos[0]?.url,
          additionalPhotos: photos.slice(1).flatMap((p) => (p ? [p.url] : [])),
          interests,
          contactMethods: { instagram, whatsapp },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar el perfil')
      router.push('/discover')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el perfil')
      setSaving(false)
    }
  }

  const next = () => {
    setError(null)
    if (step < 3) setStep(step + 1)
    else submit()
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <Loader2 className="animate-spin text-brand" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-cream sm:py-8">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white px-6 pb-8 pt-5 text-neutral-800 sm:min-h-[44rem] sm:rounded-[2rem] sm:shadow-sm">
        <header className="relative flex h-10 items-center justify-center">
          {step > 1 && (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep(step - 1)
              }}
              aria-label="Volver"
              className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-xl border border-neutral-200 text-neutral-600"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="text-lg font-semibold text-brand">Cecify</span>
        </header>

        <div className="mt-6">
          <StepIndicator current={step} />
        </div>

        <h1 className="mt-8 text-center text-2xl font-semibold">{TITLES[step - 1]}</h1>

        <div className="mt-6 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.18 }}
            >
              {step === 1 && (
                <div className="space-y-5">
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Nombre</span>
                    <input
                      className={inputClass}
                      placeholder="Cómo querés que te vean"
                      maxLength={NAME_MAX}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Edad</span>
                    <input
                      className={inputClass}
                      type="number"
                      inputMode="numeric"
                      min={AGE_MIN}
                      max={AGE_MAX}
                      placeholder={`${AGE_MIN}+`}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 flex justify-between font-medium">
                      Sobre vos <span className="font-normal text-neutral-400">{bio.length}/{BIO_MAX}</span>
                    </span>
                    <textarea
                      className={`${inputClass} resize-none`}
                      rows={3}
                      maxLength={BIO_MAX}
                      placeholder="Contá algo que rompa el hielo"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                  </label>
                </div>
              )}

              {step === 2 && (
                <div className="flex flex-col items-center gap-6">
                  <PhotoSlot
                    main
                    preview={photos[0]?.preview ?? null}
                    uploading={uploading === 0}
                    onFile={(f) => onPhoto(0, f)}
                  />
                  <div className="flex gap-4">
                    {photos.slice(1).map((p, i) => (
                      <PhotoSlot
                        key={i}
                        preview={p?.preview ?? null}
                        uploading={uploading === i + 1}
                        onFile={(f) => onPhoto(i + 1, f)}
                      />
                    ))}
                  </div>
                  <p className="text-center text-xs text-neutral-400">
                    La foto principal es obligatoria. Las otras tres son opcionales.
                  </p>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-7">
                  <section>
                    <h2 className="mb-3 flex justify-between text-sm font-medium">
                      Intereses
                      <span className="font-normal text-neutral-400">
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
                              on
                                ? 'border-brand bg-brand text-white'
                                : 'border-neutral-200 bg-white text-neutral-600 hover:border-brand'
                            }`}
                          >
                            {interest}
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section className="space-y-4">
                    <div>
                      <h2 className="text-sm font-medium">Cómo te contactan tus matches</h2>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        Solo se muestra cuando hay match. Completá al menos uno.
                      </p>
                    </div>
                    <input
                      className={inputClass}
                      placeholder="Instagram (@usuario)"
                      autoCapitalize="none"
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                    />
                    <input
                      className={inputClass}
                      type="tel"
                      inputMode="tel"
                      placeholder="WhatsApp (+54 9 11 ...)"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                    />
                  </section>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={next}
          disabled={!stepValid || saving}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {saving && <Loader2 size={18} className="animate-spin" />}
          {step < 3 ? 'Continuar' : 'Finalizar'}
        </button>
      </div>
    </main>
  )
}
