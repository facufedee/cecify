'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Printer, RefreshCw } from 'lucide-react'
import Qr from '@/components/admin/Qr'
import { Badge, btn, Card, ConfirmDialog, ErrorNote, inputClass, Spinner, useToast } from '@/components/admin/ui'
import { adminJson, errorMessage } from '@/lib/admin-client'
import type { EventAccess } from '@/lib/db/event'
import { eventJoinUrl } from '@/lib/event'

type Format = 'poster' | 'tables'

// <input type="datetime-local"> trabaja en hora local sin zona: "2026-11-14T18:00"
const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const at = (base: Date, days: number, hours: number) => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  d.setHours(hours, 0, 0, 0)
  return d
}
const pretty = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Poster({ url, small = false }: { url: string; small?: boolean }) {
  return (
    <article
      className={`flex break-inside-avoid flex-col items-center justify-center rounded-3xl border-2 border-brand/30 bg-cream text-center ${
        small ? 'gap-2 p-5 print:h-[134mm]' : 'gap-5 p-10 print:h-[270mm]'
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-full bg-brand font-bold text-white ${small ? 'h-10 w-10 text-sm' : 'h-16 w-16 text-xl'}`}
      >
        CL
      </span>
      <p className={`font-semibold text-brand-dark ${small ? 'text-base' : 'text-2xl'}`}>Lucas &amp; Cecilia</p>
      <h2 className={`font-bold leading-tight text-neutral-800 ${small ? 'text-xl' : 'text-4xl'}`}>Escaneá y entrá a Cecify</h2>
      <p className={`text-neutral-600 ${small ? 'text-xs' : 'text-lg'}`}>Conocé gente de la fiesta y compartí las fotos de la noche</p>
      <Qr text={url} label="QR de la fiesta" className={`rounded-2xl bg-white ${small ? 'w-40 p-2.5' : 'w-[110mm] max-w-full p-4'}`} />
      <p className={`text-neutral-500 ${small ? 'text-[10px]' : 'text-sm'}`}>Abrí la cámara del celular y apuntá al código</p>
    </article>
  )
}

export default function AdminEventPage() {
  const { show, toast } = useToast()
  const [event, setEvent] = useState<EventAccess | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [opens, setOpens] = useState('')
  const [closes, setCloses] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const [customOrigin, setCustomOrigin] = useState<string | null>(null)
  const origin = customOrigin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  const [format, setFormat] = useState<Format>('poster')
  const [copies, setCopies] = useState(4)
  // Hora de la ultima carga o guardado: el estado (abierto / cerrado) se calcula contra ella
  const [loadedAt, setLoadedAt] = useState(0)

  const load = (e: EventAccess | null) => {
    setEvent(e)
    setLoadedAt(Date.now())
    // Sin configurar: sugiere hoy de 17 h a mañana a las 8 h
    const now = new Date()
    setOpens(toLocalInput(e ? new Date(e.opensAt) : at(now, 0, 17)))
    setCloses(toLocalInput(e ? new Date(e.closesAt) : at(now, 1, 8)))
  }

  useEffect(() => {
    adminJson<{ event: EventAccess | null }>('/api/admin/event')
      .then((d) => load(d.event))
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const save = async (range: { opensAt: string; closesAt: string }, newQr = false) => {
    setSaving(true)
    setError(null)
    try {
      const d = await adminJson<{ event: EventAccess }>('/api/admin/event', { method: 'PUT', json: { ...range, newQr } })
      load(d.event)
      show(newQr ? 'QR nuevo generado' : event ? 'Horario guardado' : 'QR de la fiesta activado')
    } catch (e) {
      setError(errorMessage(e))
      throw e
    } finally {
      setSaving(false)
    }
  }

  const fromInputs = () => ({ opensAt: new Date(opens).toISOString(), closesAt: new Date(closes).toISOString() })

  if (event === undefined) {
    return <div className="flex justify-center py-16">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>
  }

  const now = loadedAt
  const status = !event
    ? null
    : now < Date.parse(event.opensAt)
      ? { tone: 'amber' as const, text: `Abre el ${pretty(event.opensAt)}` }
      : now >= Date.parse(event.closesAt)
        ? { tone: 'neutral' as const, text: 'Cerrado' }
        : { tone: 'green' as const, text: `Abierto hasta el ${pretty(event.closesAt)}` }

  const base = origin.trim()
  const validBase = /^https?:\/\/[^\s/]+/i.test(base)
  const isLocal = /localhost|127\.0\.0\.1|192\.168\.|10\./.test(base)
  const url = event && validBase ? eventJoinUrl(base, event.key) : null
  const validWindow = opens && closes && new Date(closes) > new Date(opens)

  return (
    <div className="space-y-5">
      <div className="space-y-4 print:hidden">
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="text-base font-semibold">QR de la fiesta</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Un mismo QR para la entrada y todas las mesas. Quien lo escanea pone su nombre y su WhatsApp y entra, sin estar
              cargado antes. Solo funciona en el horario que elijas.
            </p>
          </div>

          {status && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={status.tone}>{status.text}</Badge>
              <span className="text-neutral-500">
                {event!.joined} {event!.joined === 1 ? 'persona entró' : 'personas entraron'} con el QR
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Funciona desde</span>
              <input type="datetime-local" className={inputClass} value={opens} onChange={(e) => setOpens(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Hasta</span>
              <input type="datetime-local" className={inputClass} value={closes} onChange={(e) => setCloses(e.target.value)} />
            </label>
          </div>
          {!validWindow && <ErrorNote>El cierre tiene que ser después de la apertura</ErrorNote>}
          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={!validWindow || saving} onClick={() => save(fromInputs()).catch(() => {})}>
              {event ? 'Guardar horario' : 'Activar QR de la fiesta'}
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={saving}
              onClick={() => {
                const start = new Date()
                save({ opensAt: start.toISOString(), closesAt: new Date(start.getTime() + 12 * 3600_000).toISOString() }).catch(() => {})
              }}
            >
              Abrir ahora por 12 h
            </button>
            {event && (
              <button type="button" className={btn.ghost} onClick={() => setConfirmNew(true)}>
                <RefreshCw size={15} /> Cambiar el QR
              </button>
            )}
          </div>
        </Card>

        {event && (
          <Card className="space-y-4 p-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Dirección de la app</span>
              <input
                className={inputClass}
                value={origin}
                onChange={(e) => setCustomOrigin(e.target.value)}
                inputMode="url"
                autoCapitalize="none"
                placeholder="https://tu-app.com"
              />
              <span className="mt-1 block text-xs text-neutral-500">Es la dirección que abre el QR: tiene que ser la pública.</span>
            </label>
            {!validBase && <ErrorNote>Escribí una dirección que empiece con http:// o https://</ErrorNote>}
            {validBase && isLocal && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Esta dirección solo funciona en tu red o tu computadora. Antes de imprimir, cambiala por la dirección pública.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Formato</span>
                <select className={inputClass} value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="poster">Cartel A4 (entrada)</option>
                  <option value="tables">4 por hoja (mesas)</option>
                </select>
              </label>
              {format === 'tables' && (
                <label className="block w-32 text-sm">
                  <span className="mb-1 block font-medium">Cantidad</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={inputClass}
                    value={copies}
                    onChange={(e) => setCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                  />
                </label>
              )}
              <button type="button" className={btn.primary} disabled={!url} onClick={() => window.print()}>
                <Printer size={16} /> Imprimir
              </button>
              {url && (
                <a className={btn.secondary} href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> Probar
                </a>
              )}
            </div>
            <p className="text-xs text-neutral-500">
              Cualquiera con una foto del QR puede entrar mientras esté abierto. Si se filtra, cambialo: los carteles impresos dejan
              de funcionar.
            </p>
          </Card>
        )}
      </div>

      {url && (
        <section aria-label="Vista previa para imprimir" className={format === 'tables' ? 'grid grid-cols-2 gap-3 print:gap-2' : ''}>
          {format === 'poster' ? (
            <Poster url={url} />
          ) : (
            Array.from({ length: copies }, (_, i) => <Poster key={i} url={url} small />)
          )}
        </section>
      )}
      <style>{`@media print { @page { size: A4; margin: 10mm } body { background: #fff !important } }`}</style>

      {confirmNew && (
        <ConfirmDialog
          title="Cambiar el QR de la fiesta"
          message="El QR actual deja de funcionar al instante: vas a tener que volver a imprimir los carteles. Quien ya entró sigue adentro."
          confirmLabel="Cambiar el QR"
          onClose={() => setConfirmNew(false)}
          onConfirm={() => save({ opensAt: event!.opensAt, closesAt: event!.closesAt }, true)}
        />
      )}
      {toast}
    </div>
  )
}
