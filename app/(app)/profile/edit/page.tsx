'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { useMe } from '@/components/app/MeProvider'
import PushToggle from '@/components/app/PushToggle'
import PhotoSlot from '@/components/onboarding/PhotoSlot'
import BioPicks from '@/components/profile/BioPicks'
import ModeFields from '@/components/profile/ModeFields'
import ActionSheet from '@/components/wall/ActionSheet'
import PhotoEditor from '@/components/photo/PhotoEditor'
import { authFetch, clearToken } from '@/lib/client-auth'
import { PROFILE_ASPECTS, uploadPhoto } from '@/lib/client-photo'
import { disablePushQuietly } from '@/lib/push-client'
import { disconnectSocket } from '@/lib/socket'
import {
  AGE_MAX,
  AGE_MIN,
  BIO_MAX,
  INTERESTS,
  MAX_EXTRA_PHOTOS,
  MAX_INTERESTS,
  NAME_MAX,
  DEFAULT_PREFS,
  prefsComplete,
  ageProblem,
  cleanAgeInput,
  type LookingFor,
  type MatchPrefs,
  type Profile,
  type Side,
} from '@/lib/profile-schema'

const field =
  'w-full border-b border-ig-border bg-transparent py-2 text-sm outline-none transition placeholder:text-ig-muted focus:border-ig-text'

export default function EditProfilePage() {
  const router = useRouter()
  const { reload } = useMe()
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false)

  const [side, setSide] = useState<Side | null>(null)
  const [wantsMatch, setWantsMatch] = useState(true)
  const [lookingFor, setLookingFor] = useState<LookingFor[]>([])
  const [prefs, setPrefs] = useState<MatchPrefs>(DEFAULT_PREFS)

  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [bio, setBio] = useState('')
  const bioRef = useRef<HTMLTextAreaElement>(null)
  const [ageTouched, setAgeTouched] = useState(false)
  // indice 0 = principal, 1..3 = adicionales; cada uno es la URL ya subida (o null)
  const [photos, setPhotos] = useState<(string | null)[]>(Array(1 + MAX_EXTRA_PHOTOS).fill(null))
  const [uploading, setUploading] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ index: number; file: File } | null>(null) // foto que se esta encuadrando
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
        setSide(profile.side)
        setWantsMatch(profile.wantsMatch)
        setLookingFor(profile.lookingFor)
        setPrefs({ gender: profile.gender, interestedIn: profile.interestedIn, prefAgeMin: profile.prefAgeMin, prefAgeMax: profile.prefAgeMax })
        setReady(true)
      })
      .catch(() => !cancelled && setError('No se pudo cargar tu perfil'))
    return () => {
      cancelled = true
    }
  }, [router])

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
      setPhotos((prev) => prev.map((p, i) => (i === index ? url : p)))
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
  const ageError = ageTouched || age.length === 2 ? ageProblem(age) : null
  const nameError = !name.trim() ? 'Poné tu nombre' : null
  const valid =
    name.trim().length > 0 &&
    Number.isInteger(ageNum) &&
    ageNum >= AGE_MIN &&
    ageNum <= AGE_MAX &&
    photos[0] !== null &&
    side !== null &&
    // Intereses, contacto y que buscas solo se piden si participa del match
    (!wantsMatch ||
      (lookingFor.length > 0 &&
        prefsComplete(prefs) &&
        interests.length > 0 &&
        (instagram.trim() !== '' || whatsapp.trim() !== ''))) &&
    uploading === null

  const logoutAll = async () => {
    setConfirmLogoutAll(false)
    setError(null)
    try {
      await disablePushQuietly() // primero, con el token todavia vigente
      const res = await authFetch('/api/auth/logout-all', { method: 'POST' })
      if (!res.ok) throw new Error()
      disconnectSocket()
      clearToken()
      router.replace('/login')
    } catch {
      setError('No se pudo cerrar las sesiones, probá de nuevo')
    }
  }

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
          side,
          wantsMatch,
          lookingFor,
          ...prefs,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      await reload() // la barra de navegacion depende del modo
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
        <button type="button" onClick={() => router.back()} aria-label="Cancelar" className="tap relative p-1">
          <X size={26} />
        </button>
        <h1 className="text-base font-semibold">Editar perfil</h1>
        <button
          type="button"
          onClick={save}
          disabled={!valid || saving}
          className="tap relative min-w-[3.5rem] text-right text-sm font-semibold text-ig-link disabled:opacity-40"
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
            <input
              className={field}
              value={name}
              maxLength={NAME_MAX}
              aria-invalid={nameError !== null}
              onChange={(e) => setName(e.target.value)}
            />
            {nameError && <span className="mt-1 block text-ig-like">{nameError}</span>}
          </label>
          <label className="block text-xs text-ig-muted">
            Edad
            <input
              className={field}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={age}
              aria-invalid={ageError !== null}
              onChange={(e) => setAge(cleanAgeInput(e.target.value))}
              onBlur={() => setAgeTouched(true)}
            />
            {ageError && <span className="mt-1 block text-ig-like">{ageError}</span>}
          </label>
          <div className="text-xs text-ig-muted">
            <label htmlFor="bio" className="flex justify-between">
              Sobre vos
              <span>
                {bio.length}/{BIO_MAX}
              </span>
            </label>
            <textarea
              id="bio"
              ref={bioRef}
              className={`${field} resize-none`}
              rows={2}
              maxLength={BIO_MAX}
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
        </section>

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
        {!wantsMatch && (
          <p className="-mt-4 text-xs text-ig-muted">
            Dejás de aparecer en Descubrir y no podés dar likes. Los matches que ya tenés se mantienen.
          </p>
        )}

        {wantsMatch && (
        <>
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
                  className={`rounded-full border px-3.5 py-2 text-sm transition ${
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
        </>
        )}

        <PushToggle />

        <Link href="/profile/blocked" className="block text-center text-sm font-semibold text-ig-link">
          Cuentas bloqueadas
        </Link>

        <button
          type="button"
          onClick={() => setConfirmLogoutAll(true)}
          className="block w-full text-center text-sm font-semibold text-ig-like"
        >
          Cerrar sesión en todos los dispositivos
        </button>

        {error && (
          <p role="alert" className="text-center text-sm text-ig-like">
            {error}
          </p>
        )}
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

      <AnimatePresence>
        {confirmLogoutAll && (
          <ActionSheet
            key="logout-all"
            title="¿Cerrar sesión en todos los dispositivos?"
            message="Vas a tener que volver a entrar con tu enlace o tu código, también en este dispositivo."
            onClose={() => setConfirmLogoutAll(false)}
            actions={[{ label: 'Cerrar todas las sesiones', destructive: true, onClick: logoutAll }]}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
