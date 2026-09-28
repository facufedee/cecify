'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import Qr from '@/components/admin/Qr'
import { btn, Card, EmptyState, ErrorNote, inputClass, Spinner } from '@/components/admin/ui'
import { adminJson, downloadCsv, errorMessage } from '@/lib/admin-client'
import type { AdminGuest } from '@/lib/db/admin'
import { prettyCode } from '@/lib/format'
import { hasRealEmail } from '@/lib/event'
import { inviteUrl } from '@/lib/invite'

type Page = { guests: AdminGuest[]; total: number }
// Invitado con codigo visible (a un admin no le llega el de las cuentas con rol)
type InvitableGuest = AdminGuest & { code: string; email: string }
// La tarjeta personal necesita email (el enlace entra con email + codigo). Quien entra con el QR de la fiesta o se
// elige de la lista no la necesita
const hasCode = (g: AdminGuest): g is InvitableGuest => g.code !== null && hasRealEmail(g.email)

// Tarjeta para imprimir: cabe 8 por hoja A4 (2 columnas x 4 filas)
function InviteCard({ guest, url }: { guest: InvitableGuest; url: string }) {
  return (
    <article className="flex break-inside-avoid gap-4 rounded-2xl border-2 border-brand/30 bg-cream p-4 print:h-[64mm] print:gap-3 print:rounded-xl print:p-3.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">CL</span>
          <span className="text-sm font-semibold text-brand-dark">Lucas &amp; Cecilia</span>
        </div>
        <p className="mt-3 text-xs text-neutral-600">Estás invitado a la fiesta y a Cecify, la app para compartir la noche.</p>
        <p className="mt-1 break-words text-lg font-semibold leading-tight text-neutral-800">{guest.name}</p>
        <div className="mt-auto pt-2 text-[11px] leading-snug text-neutral-600">
          <p>¿Sin cámara? Entrá con tu email y este código:</p>
          <p className="truncate font-medium text-neutral-800">{guest.email}</p>
          <p className="font-mono text-sm font-semibold tracking-widest text-brand-dark">{prettyCode(guest.code)}</p>
        </div>
      </div>
      <div className="flex w-[34mm] shrink-0 flex-col items-center justify-center gap-1.5 max-sm:w-28 print:w-[34mm]">
        <Qr text={url} label={`Código QR de ${guest.name}`} className="w-full rounded-lg bg-white p-1.5" />
        <p className="text-center text-[10px] font-medium text-brand-dark">Escaneá para entrar</p>
      </div>
    </article>
  )
}

export default function AdminInvitationsPage() {
  const [guests, setGuests] = useState<AdminGuest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Lo que escribio el admin; si no escribio nada, la direccion desde la que abrio el panel
  // (el panel solo se dibuja en el navegador, despues de iniciar sesion, asi que window existe)
  const [customOrigin, setCustomOrigin] = useState<string | null>(null)
  const origin = customOrigin ?? (typeof window === 'undefined' ? '' : window.location.origin)
  const [query, setQuery] = useState('')
  const [onlyNew, setOnlyNew] = useState(false)

  // Lista completa (todas las paginas)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const all: AdminGuest[] = []
      for (;;) {
        const d = await adminJson<Page>(`/api/admin/guests?offset=${all.length}`)
        all.push(...d.guests)
        if (d.guests.length === 0 || all.length >= d.total) break
      }
      if (!cancelled) setGuests(all)
    })().catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (guests ?? []).filter(hasCode).filter(
      (g) => (!onlyNew || !g.userId) && (!q || g.name.toLowerCase().includes(q) || g.email.includes(q))
    )
  }, [guests, query, onlyNew])

  const base = origin.trim()
  const validBase = /^https?:\/\/[^\s/]+/i.test(base)
  const isLocal = /localhost|127\.0\.0\.1|192\.168\.|10\./.test(base)
  const pages = Math.ceil(shown.length / 8)

  return (
    <div className="space-y-5">
      <div className="space-y-4 print:hidden">
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
              aria-invalid={!validBase}
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Es la dirección que abre el QR. Tiene que ser la pública: la de la fiesta, no la de tu computadora.
            </span>
          </label>
          {!validBase && <ErrorNote>Escribí una dirección que empiece con http:// o https://</ErrorNote>}
          {validBase && isLocal && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Esta dirección solo funciona en tu red o tu computadora. Antes de imprimir, cambiala por la dirección pública de la app.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-48 flex-1 text-sm">
              <span className="mb-1 block font-medium">Buscar</span>
              <input className={inputClass} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre o email" />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="h-4 w-4 accent-[#4A7C59]" />
              Solo los que todavía no entraron
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn.primary} disabled={!validBase || shown.length === 0} onClick={() => window.print()}>
              <Printer size={16} /> Imprimir {shown.length > 0 && `(${shown.length} ${shown.length === 1 ? 'tarjeta' : 'tarjetas'}, ${pages} ${pages === 1 ? 'hoja' : 'hojas'})`}
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={!validBase || shown.length === 0}
              onClick={() =>
                downloadCsv('enlaces-de-invitacion.csv', [
                  ['name', 'email', 'code', 'link'],
                  ...shown.map((g) => [g.name, g.email, prettyCode(g.code), inviteUrl(base, g.email, g.code)]),
                ])
              }
            >
              <Download size={15} /> Descargar enlaces (CSV)
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            En el diálogo de impresión elegí tamaño A4, márgenes predeterminados y activá &ldquo;Gráficos de fondo&rdquo; para que se vea el color de las tarjetas.
          </p>
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        {!guests && !error && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {guests && shown.length === 0 && (
          <EmptyState>{guests.length === 0 ? 'Todavía no hay invitados. Cargalos en la sección Invitados.' : 'No hay invitados que coincidan.'}</EmptyState>
        )}
      </div>

      {validBase && shown.length > 0 && (
        <section aria-label="Tarjetas de invitación" className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
          {shown.map((g) => (
            <InviteCard key={g.id} guest={g} url={inviteUrl(base, g.email, g.code)} />
          ))}
        </section>
      )}

      <style>{`@media print { @page { size: A4; margin: 10mm } body { background: #fff !important } }`}</style>
    </div>
  )
}
