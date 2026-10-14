'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Camera,
  Check,
  Clock,
  Copy,
  HeartHandshake,
  Image as ImageIcon,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  Users,
  UserX,
} from 'lucide-react'
import { Card, ErrorNote, Spinner } from '@/components/admin/ui'
import { adminJson, errorMessage } from '@/lib/admin-client'
import { describeAction } from '@/lib/admin-labels'
import type { AdminAction, AdminStats } from '@/lib/db/admin'
import { formatShortAgo } from '@/lib/format'
import { coupleTitle } from '@/lib/profile-schema'
import { useSideLabels, useWedding } from '@/lib/wedding-client'

type Overview = { stats: AdminStats; actions: AdminAction[] }

function MetricCard({
  label,
  value,
  hint,
  href,
  alert = false,
  Icon,
  accent = 'bg-brand/10 text-brand',
}: {
  label: string
  value: number
  hint?: string
  href?: string
  alert?: boolean
  Icon: React.ComponentType<{ size?: number; className?: string }>
  accent?: string
}) {
  const content = (
    <div
      className={`relative flex h-full flex-col justify-between rounded-2xl border p-4 transition-all duration-150 ${
        alert
          ? 'border-amber-300 bg-amber-50/70 shadow-sm'
          : 'border-neutral-200/80 bg-white hover:border-brand/40 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={18} />
        </span>
        {alert && (
          <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
            Atención
          </span>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl sm:text-3xl font-bold tabular-nums text-neutral-900">{value}</p>
        <p className="mt-0.5 text-xs font-medium text-neutral-600">{label}</p>
        {hint && <p className="mt-1 text-[11px] text-neutral-500 leading-tight">{hint}</p>}
      </div>
    </div>
  )

  return href ? (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  )
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const labels = useSideLabels()
  const wedding = useWedding()

  useEffect(() => {
    let cancelled = false
    adminJson<Overview>('/api/admin/overview')
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  // Si se sale de la pagina con el aviso de "copiado" activo, el timer no queda colgado
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  const copyCode = async () => {
    if (!wedding?.code) return
    let ok = true
    try {
      await navigator.clipboard.writeText(wedding.code)
    } catch {
      // Sin permiso para el portapapeles: se avisa para que lo copien a mano
      ok = false
    }
    setCopyState(ok ? 'copied' : 'failed')
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), ok ? 2000 : 4000)
  }

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }

  const { stats: s, actions } = data
  const weddingName = coupleTitle(wedding)
  const sides = [
    { key: 'bride', label: labels.bride, value: s.sides.bride, color: 'bg-brand' },
    { key: 'groom', label: labels.groom, value: s.sides.groom, color: 'bg-sky-600' },
    { key: 'both', label: labels.both, value: s.sides.both, color: 'bg-amber-500' },
    { key: 'unset', label: 'Sin dato', value: s.sides.unset, color: 'bg-neutral-300' },
  ]
  const sidesTotal = sides.reduce((sum, x) => sum + x.value, 0)

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero: casamiento actual; invitados, fotos y reportes se abren desde sus metricas */}
      <section
        aria-label="Resumen del casamiento"
        className="relative overflow-hidden rounded-3xl border border-brand/20 bg-gradient-to-br from-brand/10 via-brand/5 to-white p-5 sm:p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 items-center gap-1 rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
                <Sparkles size={12} /> Casamiento
              </span>
              {wedding?.code && (
                <button
                  type="button"
                  onClick={copyCode}
                  aria-label={`Copiar el código ${wedding.code}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-semibold tracking-wider text-neutral-800 shadow-sm hover:bg-neutral-50 transition active:scale-95"
                >
                  <span>{wedding.code}</span>
                  {copyState === 'copied' ? (
                    <Check size={12} className="text-brand" />
                  ) : (
                    <Copy size={12} className="text-neutral-500" />
                  )}
                </button>
              )}
              <span aria-live="polite" className={`text-xs font-medium ${copyState === 'failed' ? 'text-red-600' : 'text-brand'}`}>
                {copyState === 'copied' && 'Copiado'}
                {copyState === 'failed' && 'No se pudo copiar, anotalo a mano'}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900">
              {weddingName ? weddingName : 'Panel de Control'}
            </h2>
            <p className="text-xs sm:text-sm text-neutral-600">
              {weddingName
                ? 'Gestioná los invitados, horarios de acceso y el contenido en vivo de la fiesta.'
                : 'Configurá los nombres de la pareja para personalizar la experiencia.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
            <Link
              href="/admin/wedding"
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition active:scale-95"
            >
              <HeartHandshake size={16} />
              <span>Editar casamiento</span>
            </Link>
            <Link
              href="/admin/event"
              className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 transition active:scale-95"
            >
              <Clock size={16} />
              <span>Registro & horarios</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Grid de métricas clave */}
      <section aria-label="Métricas" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label="Invitados"
          value={s.guestsTotal}
          href="/admin/guests"
          hint={`${s.guestsJoined} ya ingresaron`}
          Icon={Users}
          accent="bg-blue-50 text-blue-700"
        />
        <MetricCard
          label="Perfiles activos"
          value={s.profilesTotal}
          hint={`${s.wantsMatch} para citas · ${s.onlyWall} solo muro`}
          Icon={HeartHandshake}
          accent="bg-emerald-50 text-emerald-700"
        />
        <MetricCard
          label="Matches formados"
          value={s.matches}
          hint={`${s.messages} mensajes enviados`}
          Icon={MessageCircle}
          accent="bg-rose-50 text-rose-600"
        />
        <MetricCard
          label="Fotos en muro"
          value={s.photos}
          href="/admin/content"
          hint={`${s.comments} comentarios`}
          Icon={ImageIcon}
          accent="bg-purple-50 text-purple-700"
        />
        <MetricCard
          label="Historias activas"
          value={s.storiesActive}
          href="/admin/content"
          hint="Momentos en 24h"
          Icon={Camera}
          accent="bg-amber-50 text-amber-700"
        />
        <MetricCard
          label="Reportes"
          value={s.reportsOpen}
          href="/admin/reports"
          alert={s.reportsOpen > 0}
          hint={s.reportsOpen > 0 ? 'Esperan revisión' : 'Todo al día'}
          Icon={ShieldAlert}
          accent={s.reportsOpen > 0 ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-700'}
        />
        <MetricCard
          label="Bloqueos"
          value={s.blocks}
          hint="Entre invitados"
          Icon={UserX}
          accent="bg-neutral-100 text-neutral-600"
        />
      </section>

      {/* Distribución de invitados */}
      <section aria-label="De parte de quién vienen">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-neutral-900">De parte de quién vienen</h2>
          <span className="text-xs font-medium text-neutral-500">
            {sidesTotal} con lado asignado
          </span>
        </div>
        <Card className="p-4 sm:p-5">
          {sidesTotal === 0 ? (
            <p className="text-sm text-neutral-500">Todavía no hay perfiles creados.</p>
          ) : (
            <>
              <div
                className="flex h-3.5 overflow-hidden rounded-full bg-neutral-100 shadow-inner"
                role="img"
                aria-label={sides.map((x) => `${x.label}: ${x.value}`).join(', ')}
              >
                {sides.map((x) => (
                  <span
                    key={x.key}
                    className={`${x.color} transition-all duration-300`}
                    style={{ width: `${(x.value / sidesTotal) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 text-xs sm:text-sm">
                {sides.map((x) => (
                  <li key={x.key} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${x.color}`} />
                    <span className="font-medium text-neutral-700">{x.label}</span>
                    <span className="tabular-nums font-semibold text-neutral-900">{x.value}</span>
                    <span className="text-[11px] text-neutral-500">
                      ({Math.round((x.value / sidesTotal) * 100)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      {/* Últimas acciones de moderación y admin */}
      <section aria-label="Últimas acciones">
        <h2 className="mb-3 text-sm font-bold text-neutral-900">Últimas acciones de administración</h2>
        <Card className="overflow-hidden">
          {actions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-500">
              Todavía no se registró ninguna acción en el sistema.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {actions.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 px-4 py-3 text-xs sm:text-sm hover:bg-neutral-50/60 transition">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                    <span className="truncate">
                      <span className="font-semibold text-neutral-900">{a.actorName}</span>{' '}
                      <span className="text-neutral-600">{describeAction(a.action, a.details)}</span>
                    </span>
                  </div>
                  <time dateTime={a.createdAt} className="shrink-0 text-[11px] sm:text-xs font-medium text-neutral-500">
                    {formatShortAgo(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}
