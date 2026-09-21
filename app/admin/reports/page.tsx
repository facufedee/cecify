'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Lock, Trash2 } from 'lucide-react'
import { Avatar, Badge, btn, Card, ConfirmDialog, EmptyState, ErrorNote, Spinner, useToast } from '@/components/admin/ui'
import { adminJson, errorMessage } from '@/lib/admin-client'
import { REASON_LABELS, STATUS_LABELS, TYPE_LABELS } from '@/lib/admin-labels'
import type { AdminReport, ReportStatus } from '@/lib/db/admin'
import { formatShortAgo } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/roles'

const PAGE = 30

const FILTERS: { value: ReportStatus | ''; label: string }[] = [
  { value: 'open', label: 'Abiertos' },
  { value: 'reviewed', label: 'Revisados' },
  { value: 'dismissed', label: 'Descartados' },
  { value: '', label: 'Todos' },
]

const STATUS_TONE = { open: 'amber', reviewed: 'green', dismissed: 'neutral' } as const

// Que se borra al "Borrar contenido" y con que ruta
const DELETE_URL: Partial<Record<AdminReport['type'], (id: string) => string>> = {
  photo: (id) => `/api/admin/content/photos/${id}`,
  story: (id) => `/api/admin/content/stories/${id}`,
  comment: (id) => `/api/admin/content/comments/${id}`,
}

const DELETE_LABEL: Partial<Record<AdminReport['type'], string>> = {
  photo: 'Borrar foto',
  story: 'Borrar historia',
  comment: 'Borrar comentario',
}

type Ctx = Record<string, unknown> | null
const text = (v: unknown) => (typeof v === 'string' ? v : '')

// Copia de lo reportado tomada al momento del reporte (sigue ahi aunque se borre el original)
function Evidence({ report }: { report: AdminReport }) {
  const ctx: Ctx = report.context
  if (!ctx) return null

  if (report.type === 'chat') {
    if (ctx.restricted) {
      return (
        <p className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
          <Lock size={15} /> La conversación solo la puede ver un superadministrador.
        </p>
      )
    }
    const messages = (Array.isArray(ctx.messages) ? ctx.messages : []) as { from: string; content: string; at: string }[]
    return (
      <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg bg-neutral-50 p-3" aria-label="Últimos mensajes">
        {messages.length === 0 && <li className="text-sm text-neutral-500">Sin mensajes.</li>}
        {messages.map((m, i) => (
          <li key={i} className={`flex ${m.from === 'reportado' ? 'justify-start' : 'justify-end'}`}>
            <span
              className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
                m.from === 'reportado' ? 'bg-red-100 text-red-900' : 'bg-white text-neutral-700 ring-1 ring-neutral-200'
              }`}
            >
              <span className="block text-[10px] font-medium uppercase opacity-60">
                {m.from === 'reportado' ? report.reported.name : 'Quien reportó'}
              </span>
              {m.content}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  if (report.type === 'photo' || report.type === 'story') {
    return (
      <div className="flex gap-3">
        {text(ctx.photoUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={text(ctx.photoUrl)} alt="Lo reportado" loading="lazy" className="h-28 w-28 shrink-0 rounded-lg bg-neutral-100 object-cover" />
        )}
        {text(ctx.caption) && <p className="text-sm text-neutral-700">“{text(ctx.caption)}”</p>}
      </div>
    )
  }

  if (report.type === 'comment') {
    return <blockquote className="rounded-lg border-l-4 border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">“{text(ctx.body)}”</blockquote>
  }

  // profile
  return (
    <div className="flex items-start gap-3 rounded-lg bg-neutral-50 p-3">
      <Avatar src={text(ctx.photo)} name={text(ctx.name)} size={44} />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{text(ctx.name)}</p>
        {text(ctx.bio) && <p className="text-neutral-600">{text(ctx.bio)}</p>}
      </div>
    </div>
  )
}

function ReportCard({
  report,
  onStatus,
  onDeleteContent,
}: {
  report: AdminReport
  onStatus: (r: AdminReport, s: ReportStatus) => Promise<void>
  onDeleteContent: (r: AdminReport) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = async (s: ReportStatus) => {
    setBusy(true)
    setError(null)
    try {
      await onStatus(report, s)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const canDelete = Boolean(DELETE_URL[report.type] && report.targetId)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[report.status]}>{STATUS_LABELS[report.status]}</Badge>
        <span className="text-sm font-semibold">
          {TYPE_LABELS[report.type]} · {REASON_LABELS[report.reason] ?? report.reason}
        </span>
        <time dateTime={report.createdAt} className="ml-auto text-xs text-neutral-500">
          {formatShortAgo(report.createdAt)}
        </time>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Avatar src={report.reported.photo} name={report.reported.name} />
          <div>
            <p className="font-medium leading-tight">{report.reported.name}</p>
            <p className="text-xs text-neutral-500">
              Reportado
              {report.reported.role !== 'guest' && ` · ${ROLE_LABELS[report.reported.role]}`}
            </p>
          </div>
          {report.reported.reportsTotal > 1 && (
            <Badge tone={report.reported.reportsOpen > 1 ? 'red' : 'amber'}>
              {report.reported.reportsTotal} reportes en total
            </Badge>
          )}
        </div>
        <p className="text-neutral-600">
          Reportó: <span className="font-medium text-neutral-800">{report.reporter.name}</span>
        </p>
      </div>

      {report.details && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-medium">Dijo: </span>“{report.details}”
        </p>
      )}

      <Evidence report={report} />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {report.status === 'open' ? (
          <>
            <button type="button" className={btn.primary} disabled={busy} onClick={() => change('reviewed')}>
              Marcar revisado
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => change('dismissed')}>
              Descartar
            </button>
          </>
        ) : (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => change('open')}>
            Reabrir
          </button>
        )}
        {canDelete && (
          <button type="button" className={`${btn.ghost} !text-red-600`} disabled={busy} onClick={() => setConfirming(true)}>
            <Trash2 size={15} /> {DELETE_LABEL[report.type]}
          </button>
        )}
        <Link href={`/admin/guests?q=${encodeURIComponent(report.reported.name)}`} className={`${btn.ghost} ml-auto`}>
          Ver en Invitados
        </Link>
      </div>

      {confirming && (
        <ConfirmDialog
          title={DELETE_LABEL[report.type] ?? 'Borrar'}
          message="Se borra del muro y de la app para todos, y el reporte queda como revisado. La copia que ves acá se conserva."
          confirmLabel="Borrar"
          onClose={() => setConfirming(false)}
          onConfirm={() => onDeleteContent(report)}
        />
      )}
    </Card>
  )
}

export default function AdminReportsPage() {
  const [filter, setFilter] = useState<ReportStatus | ''>('open')
  const [reports, setReports] = useState<AdminReport[] | null>(null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { show, toast } = useToast()

  const url = useCallback(
    (before?: string) => {
      const p = new URLSearchParams()
      if (filter) p.set('status', filter)
      if (before) p.set('before', before)
      return `/api/admin/reports?${p}`
    },
    [filter]
  )

  useEffect(() => {
    let cancelled = false
    adminJson<{ reports: AdminReport[] }>(url())
      .then((d) => {
        if (cancelled) return
        setError(null)
        setReports(d.reports)
        setMore(d.reports.length === PAGE)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [url])

  const changeFilter = (f: ReportStatus | '') => {
    if (f === filter) return
    setReports(null)
    setError(null)
    setFilter(f)
  }

  const loadMore = async () => {
    if (!reports?.length) return
    setLoadingMore(true)
    try {
      const d = await adminJson<{ reports: AdminReport[] }>(url(reports[reports.length - 1].createdAt))
      setReports((prev) => [...(prev ?? []), ...d.reports])
      setMore(d.reports.length === PAGE)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoadingMore(false)
    }
  }

  // Al cambiar el estado, el reporte sale de la lista si ya no coincide con el filtro
  const applyStatus = (id: string, status: ReportStatus) =>
    setReports((prev) =>
      (prev ?? []).flatMap((r) => (r.id !== id ? [r] : filter && filter !== status ? [] : [{ ...r, status }]))
    )

  const onStatus = async (r: AdminReport, status: ReportStatus) => {
    await adminJson(`/api/admin/reports/${r.id}`, { method: 'PATCH', json: { status } })
    applyStatus(r.id, status)
    show(status === 'reviewed' ? 'Reporte revisado' : status === 'dismissed' ? 'Reporte descartado' : 'Reporte reabierto')
  }

  const onDeleteContent = async (r: AdminReport) => {
    const path = DELETE_URL[r.type]?.(r.targetId!)
    if (!path) return
    try {
      await adminJson(path, { method: 'DELETE' })
    } catch (e) {
      // Si ya no existe (lo borro su autor o otro admin) el reporte se cierra igual
      if (!/no encontrad/i.test(errorMessage(e))) throw e
    }
    await adminJson(`/api/admin/reports/${r.id}`, { method: 'PATCH', json: { status: 'reviewed' } })
    applyStatus(r.id, 'reviewed')
    show('Contenido borrado')
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Estado" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => changeFilter(f.value)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition ${
              filter === f.value ? 'border-brand bg-brand text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:border-brand'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!reports && !error && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {reports?.length === 0 && (
        <EmptyState>{filter === 'open' ? 'No hay reportes abiertos. ¡Todo tranquilo!' : 'No hay reportes en esta lista.'}</EmptyState>
      )}

      <div className="space-y-4">
        {reports?.map((r) => (
          <ReportCard key={r.id} report={r} onStatus={onStatus} onDeleteContent={onDeleteContent} />
        ))}
      </div>

      {more && (
        <div className="flex justify-center">
          <button type="button" className={btn.secondary} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
      {toast}
    </div>
  )
}
