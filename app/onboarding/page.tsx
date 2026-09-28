'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Loader2 } from 'lucide-react'
import StepIndicator from '@/components/onboarding/StepIndicator'
import PhotoSlot from '@/components/onboarding/PhotoSlot'
import BioPicks from '@/components/profile/BioPicks'
import ModeFields from '@/components/profile/ModeFields'
import PhotoEditor from '@/components/photo/PhotoEditor'
import { authFetch, getToken } from '@/lib/client-auth'
import { PROFILE_ASPECTS, uploadPhoto } from '@/lib/client-photo'
import {
  AGE_MAX,
  AGE_MIN,
  BIO_MAX,
  INTERESTS,
  MAX_EXTRA_PHOTOS,
  MAX_INTERESTS,
  NAME_MAX,
  ageProblem,
  cleanAgeInput,
  isSide,
  DEFAULT_PREFS,
  prefsComplete,
  type LookingFor,
  type MatchPrefs,
  type Side,
} from '@/lib/profile-schema'

type Photo = { url: string; preview: string } | null

// Quien solo quiere compartir momentos se salta intereses y contacto
type StepId = 'mode' | 'you' | 'photos' | 'contact'

const TITLES: Record<StepId, string> = {
  mode: 'Tu lugar en la fiesta',
  you: 'Contanos sobre vos',
  photos: 'Subí tus fotos',
  contact: 'Tus intereses y contacto',
}

const inputClass =
  'w-full rounded-xl bg-cream px-4 py-3 text-sm text-neutral-800 outline-none ring-1 ring-transparent transition placeholder:text-neutral-600 focus:bg-white focus:ring-brand'

export default function OnboardingPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [side, setSide] = useState<Side | null>(null)
  const [wantsMatch, setWantsMatch] = useState<boolean | null>(null)
  const [lookingFor, setLookingFor] = useState<LookingFor[]>([])
  const [prefs, setPrefs] = useState<MatchPrefs>(DEFAULT_PREFS)
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [bio, setBio] = useState('')
  const bioRef = useRef<HTMLTextAreaElement>(null)
  // Los errores de un campo se muestran recien cuando la persona paso por el (no apenas abre la pantalla)
  const [touched, setTouched] = useState({ name: false, age: false })
  // indice 0 = foto principal, 1..3 = adicionales
  const [photos, setPhotos] = useState<Photo[]>(Array(1 + MAX_EXTRA_PHOTOS).fill(null))
  const [uploading, setUploading] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ index: number; file: File } | null>(null) // foto que se esta encuadrando
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
        if (isSide(data.guestSide)) setSide(data.guestSide) // lo cargo el admin: se puede cambiar
        // Lo que puso al entrar con el QR de la fiesta
        if (typeof data.guestPhone === 'string') setWhatsapp(`+${data.guestPhone}`)
        if (typeof data.guestInstagram === 'string') setInstagram(data.guestInstagram)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [router])

  const steps: StepId[] = wantsMatch === false ? ['mode', 'you', 'photos'] : ['mode', 'you', 'photos', 'contact']
  const stepId = steps[step - 1]
  const isLast = step === steps.length

  const ageNum = Number(age)
  // Con un solo digito todavia puede estar escribiendo ("3" de "32"): se avisa al salir del campo
  const ageError = touched.age || age.length === 2 ? ageProblem(age) : null
  const nameError = touched.name && !name.trim() ? 'Poné tu nombre' : null
  const stepValid = {
    mode: side !== null && wantsMatch !== null && (wantsMatch === false || (lookingFor.length > 0 && prefsComplete(prefs))),
    you: name.trim().length > 0 && Number.isInteger(ageNum) && ageNum >= AGE_MIN && ageNum <= AGE_MAX,
    photos: photos[0] !== null && uploading === null,
    contact: interests.length > 0 && (instagram.trim() !== '' || whatsapp.trim() !== ''),
  }[stepId]

  // Al elegir una foto se abre el editor (encuadre, zoom, giro); al terminar se sube ya recortada
  const onPhoto = (index: number, file: File) => {
    setError(null)
    setEditing({ index, file })
  }

  const onEdited = async (blob: Blob) => {
    if (!editing) return
    const { index } = editing
    setEditing(null)
    setUploading(index)
    try {
      const url = await uploadPhoto(blob)
      setPhotos((prev) => prev.map((p, i) => (i === index ? { url, preview: URL.createObjectURL(blob) } : p)))
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
          side,
          wantsMatch,
          lookingFor,
          ...prefs,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar el perfil')
      router.push(wantsMatch === false ? '/photos' : '/discover')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el perfil')
      setSaving(false)
    }
  }

  const next = () => {
    setError(null)
    if (!isLast) setStep(step + 1)
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
          <StepIndicator current={step} total={steps.length} />
        </div>

        <h1 className="mt-8 text-center text-2xl font-semibold">{TITLES[stepId]}</h1>

        <div className="mt-6 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.18 }}
            >
              {stepId === 'mode' && (
                <ModeFields
                  side={side}
                  wantsMatch={wantsMatch}
                  lookingFor={lookingFor}
                  onSide={setSide}
                  onWantsMatch={setWantsMatch}
                  onLookingFor={setLookingFor}
                  prefs={prefs}
                  onPrefs={setPrefs}
                />
              )}

              {stepId === 'you' && (
                <div className="space-y-5">
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Nombre</span>
                    <input
                      className={inputClass}
                      placeholder="Cómo querés que te vean"
                      maxLength={NAME_MAX}
                      value={name}
                      aria-invalid={nameError !== null}
                      aria-describedby={nameError ? 'name-error' : undefined}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    />
                    {nameError && (
                      <span id="name-error" className="mt-1 block text-xs text-red-600">
                        {nameError}
                      </span>
                    )}
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium">Edad</span>
                    <input
                      className={inputClass}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={2}
                      placeholder={`Entre ${AGE_MIN} y ${AGE_MAX}`}
                      value={age}
                      aria-invalid={ageError !== null}
                      aria-describedby={ageError ? 'age-error' : undefined}
                      onChange={(e) => setAge(cleanAgeInput(e.target.value))}
                      onBlur={() => setTouched((t) => ({ ...t, age: true }))}
                    />
                    {ageError && (
                      <span id="age-error" className="mt-1 block text-xs text-red-600">
                        {ageError}
                      </span>
                    )}
                  </label>
                  <div className="text-sm">
                    <label htmlFor="bio" className="mb-1.5 flex justify-between font-medium">
                      Sobre vos <span className="font-normal text-neutral-500">{bio.length}/{BIO_MAX}</span>
                    </label>
                    <textarea
                      id="bio"
                      ref={bioRef}
                      className={`${inputClass} resize-none`}
                      rows={3}
                      maxLength={BIO_MAX}
                      placeholder="Tocá los botones de abajo o escribí algo que rompa el hielo"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                    <BioPicks
                      bio={bio}
                      max={BIO_MAX}
                      onChange={setBio}
                      textarea={bioRef}
                    />
                  </div>
                </div>
              )}

              {stepId === 'photos' && (
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
                  <p className="text-center text-xs text-neutral-500">
                    La foto principal es obligatoria. Las otras tres son opcionales.
                  </p>
                </div>
              )}

              {stepId === 'contact' && (
                <div className="space-y-7">
                  <section>
                    <h2 className="mb-3 flex justify-between text-sm font-medium">
                      Intereses
                      <span className="font-normal text-neutral-500">
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
                            className={`rounded-full border px-3.5 py-2 text-sm transition ${
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
                      <p className="mt-0.5 text-xs text-neutral-500">
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

        {editing && (
          <PhotoEditor
            file={editing.file}
            title="Encuadrá tu foto"
            aspects={PROFILE_ASPECTS}
            minLongSide={500}
            onCancel={() => setEditing(null)}
            onDone={onEdited}
          />
        )}

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
          {isLast ? 'Finalizar' : 'Continuar'}
        </button>
      </div>
    </main>
  )
}
