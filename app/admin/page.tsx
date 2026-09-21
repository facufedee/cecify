'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, ErrorNote, Spinner } from '@/components/admin/ui'
import { adminJson, errorMessage } from '@/lib/admin-client'
import { describeAction } from '@/lib/admin-labels'
import type { AdminAction, AdminStats } from '@/lib/db/admin'
import { formatShortAgo } from '@/lib/format'
import { COUPLE } from '@/lib/profile-schema'

type Overview = { stats: AdminStats; actions: AdminAction[] }

function Stat({ label, value, hint, href, alert = false }: { label: string; value: number; hint?: string; href?: string; alert?: boolean }) {
  const body = (
    <div
      className={`h-full rounded-xl border p-4 ${alert ? 'border-amber-300 bg-amber-50' : 'border-neutral-200 bg-white'} ${href ? 'transition hover:border-brand' : ''}`}
    >
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adminJson<Overview>('/api/admin/overview')
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const { stats: s, actions } = data
  const sides = [
    { key: 'bride', label: `Del lado de ${COUPLE.bride}`, value: s.sides.bride, color: 'bg-brand' },
    { key: 'groom', label: `Del lado de ${COUPLE.groom}`, value: s.sides.groom, color: 'bg-sky-600' },
    { key: 'both', label: 'De los dos', value: s.sides.both, color: 'bg-amber-500' },
    { key: 'unset', label: 'Sin dato', value: s.sides.unset, color: 'bg-neutral-300' },
  ]
  const sidesTotal = sides.reduce((sum, x) => sum + x.value, 0)

  return (
    <div className="space-y-8">
      <section aria-label="Métricas" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Reportes abiertos" value={s.reportsOpen} href="/admin/reports" alert={s.reportsOpen > 0} hint={s.reportsOpen > 0 ? 'Esperan revisión' : 'Todo al día'} />
        <Stat label="Invitados" value={s.guestsTotal} href="/admin/guests" hint={`${s.guestsJoined} ya entraron`} />
        <Stat label="Perfiles" value={s.profilesTotal} hint={`${s.wantsMatch} quieren conocer gente · ${s.onlyWall} solo muro`} />
        <Stat label="Matches" value={s.matches} hint={`${s.messages} mensajes`} />
        <Stat label="Fotos en el muro" value={s.photos} href="/admin/content" hint={`${s.comments} comentarios`} />
        <Stat label="Historias activas" value={s.storiesActive} href="/admin/content" />
        <Stat label="Bloqueos" value={s.blocks} />
      </section>

      <section aria-label="De parte de quién vienen">
        <h2 className="mb-3 text-sm font-semibold">De parte de quién vienen</h2>
        <Card className="p-4">
          {sidesTotal === 0 ? (
            <p className="text-sm text-neutral-500">Todavía no hay perfiles.</p>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={sides.map((x) => `${x.label}: ${x.value}`).join(', ')}>
                {sides.map((x) => (
                  <span key={x.key} className={x.color} style={{ width: `${(x.value / sidesTotal) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                {sides.map((x) => (
                  <li key={x.key} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${x.color}`} />
                    {x.label} <span className="tabular-nums text-neutral-500">{x.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      <section aria-label="Últimas acciones">
        <h2 className="mb-3 text-sm font-semibold">Últimas acciones de administración</h2>
        <Card>
          {actions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-neutral-500">Todavía no se hizo ninguna acción.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {actions.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{a.actorName}</span> {describeAction(a.action, a.details)}
                  </span>
                  <time dateTime={a.createdAt} className="shrink-0 text-xs text-neutral-500">
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
