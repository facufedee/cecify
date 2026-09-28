'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download, Loader2, Plus, Search, Upload } from 'lucide-react'
import { useMe } from '@/components/app/MeProvider'
import { Badge, btn, Card, ConfirmDialog, EmptyState, ErrorNote, inputClass, Modal, Spinner, useToast } from '@/components/admin/ui'
import { adminJson, downloadCsv, errorMessage } from '@/lib/admin-client'
import type { AdminGuest } from '@/lib/db/admin'
import { contactLabel, hasRealEmail } from '@/lib/event'
import { SIDES, SIDE_LABELS, type Side } from '@/lib/profile-schema'
import { ROLE_LABELS, ROLES, type Role } from '@/lib/roles'

type Page = { guests: AdminGuest[]; total: number; pageSize: number }

const sideText = (s: Side | null) => (s ? SIDE_LABELS[s] : 'Sin dato')


function SideSelect({ value, onChange }: { value: Side | ''; onChange: (v: Side | '') => void }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value as Side | '')} aria-label="De parte de quién viene">
      <option value="">Sin dato</option>
      {SIDES.map((s) => (
        <option key={s} value={s}>
          {SIDE_LABELS[s]}
        </option>
      ))}
    </select>
  )
}

function AddGuestModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [side, setSide] = useState<Side | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ code: string | null; created: boolean; email: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await adminJson<{ code: string | null; created: boolean }>('/api/admin/guests', {
        method: 'POST',
        json: { name, email, ...(side ? { side } : {}) },
      })
      setSaved({ code: r.code, created: r.created, email: email.trim() || name.trim() })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    return (
      <Modal title="Invitado agregado" onClose={onClose}>
        <div className="space-y-4 text-sm">
          <p>
            {saved.created ? 'Se agregó' : 'Ya estaba en la lista: se actualizó'} <span className="font-medium">{saved.email}</span>.
          </p>
          <p className="text-neutral-600">Ya puede entrar buscando su nombre (con el registro abierto) e inventando su PIN.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.primary} onClick={onClose}>
              Listo
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Agregar invitado" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Email <span className="font-normal text-neutral-500">(opcional)</span>
          </span>
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
          <span className="mt-1 block text-xs text-neutral-500">
            Sin email, la persona entra eligiéndose de la lista con el QR de la fiesta. Con email también puede usar su código.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">De parte de quién viene</span>
          <SideSelect value={side} onChange={setSide} />
        </label>
        <p className="text-xs text-neutral-500">El código de acceso se genera solo.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btn.primary} disabled={busy || !name.trim()}>
            {busy && <Loader2 size={16} className="animate-spin" />} Agregar
          </button>
        </div>
      </form>
    </Modal>
  )
}

type ImportResult = {
  created: number
  updated: number
  rows: { name: string; email: string | null; code: string | null; created: boolean }[]
  errors: { line: number; message: string }[]
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setCsv(await file.text())
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await adminJson<ImportResult>('/api/admin/guests', { method: 'POST', json: { csv } }))
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal title="Importación lista" onClose={onClose} wide>
        <div className="space-y-4 text-sm">
          <p>
            <span className="font-semibold">{result.created}</span> nuevos · <span className="font-semibold">{result.updated}</span>{' '}
            ya estaban y se actualizaron.
          </p>
          {result.errors.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">
                {result.errors.length} {result.errors.length === 1 ? 'fila no se importó' : 'filas no se importaron'}:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>
                    Línea {e.line}: {e.message}
                  </li>
                ))}
              </ul>
              {result.errors.length > 20 && <p className="mt-1">…y {result.errors.length - 20} más.</p>}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={btn.secondary}
              onClick={() =>
                downloadCsv('invitados.csv', [
                  ['name', 'email'],
                  ...result.rows.map((r) => [r.name, r.email ?? '']),
                ])
              }
            >
              <Download size={15} /> Descargar CSV con códigos
            </button>
            <button type="button" className={btn.primary} onClick={onClose}>
              Listo
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Importar invitados desde CSV" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg bg-neutral-50 p-3 text-neutral-600">
          <p>
            Lo más simple: pegá la lista del casamiento, <strong>un nombre por renglón</strong>. O un CSV con cabecera{' '}
            <code className="rounded bg-white px-1">name</code> y, si querés, <code className="rounded bg-white px-1">email</code> y{' '}
            <code className="rounded bg-white px-1">side</code> (novia, novio o ambos).
          </p>
          <p className="mt-1">
            Volver a importar la misma lista no duplica a nadie. Sirve coma o punto y coma.
          </p>
        </div>
        <label className={`${btn.secondary} cursor-pointer`}>
          <Upload size={15} /> Elegir archivo .csv
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium">o pegá el contenido</span>
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={8}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'Ana Pérez\nLuis Gómez\nMariana López'}
          />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={btn.primary} disabled={busy || !csv.trim()} onClick={submit}>
            {busy && <Loader2 size={16} className="animate-spin" />} Importar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function EditGuestModal({
  guest,
  isSuper,
  onClose,
  onChanged,
  notify,
}: {
  guest: AdminGuest
  isSuper: boolean
  onClose: () => void
  onChanged: () => void
  notify: (m: string) => void
}) {
  const [name, setName] = useState(guest.name)
  const [side, setSide] = useState<Side | ''>(guest.side ?? '')
  const [role, setRole] = useState<Role>(guest.role ?? 'guest')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'sessions' | 'release' | null>(null)

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', async () => {
      await adminJson(`/api/admin/guests/${guest.id}`, { method: 'PATCH', json: { name, side: side || null } })
      onChanged()
      notify('Cambios guardados')
      onClose()
    })

  const changeRole = (next: Role) =>
    run('role', async () => {
      await adminJson(`/api/admin/users/${guest.userId}/role`, { method: 'PUT', json: { role: next } })
      setRole(next)
      onChanged()
      notify(`Ahora es ${ROLE_LABELS[next].toLowerCase()}`)
    })

  const changed = name.trim() !== guest.name || (side || null) !== guest.side

  return (
    <Modal title="Editar invitado" onClose={onClose}>
      <div className="space-y-5 text-sm">
        <p className="text-neutral-500">{contactLabel(guest.email)}</p>

        <label className="block">
          <span className="mb-1 block font-medium">Nombre</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium">De parte de quién viene</span>
          <SideSelect value={side} onChange={setSide} />
        </label>

        <div>
          <span className="mb-1 block font-medium">Acceso</span>
          {!guest.claimed ? (
            <p className="text-xs text-neutral-500">
              {guest.userId
                ? 'Le reiniciaron el PIN: la próxima vez que entre inventa uno nuevo.'
                : 'Todavía no se registró: entra buscando su nombre cuando el registro esté abierto.'}
            </p>
          ) : guest.code === null ? (
            <p className="text-xs text-neutral-500">
              Es {ROLE_LABELS[role].toLowerCase()}: solo un superadministrador puede reiniciar su PIN o cerrar sus sesiones.
            </p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">Ya se registró: entra con su nombre y su PIN.</p>
              <button type="button" className={`${btn.ghost} mt-1 -ml-2.5`} onClick={() => setConfirm('release')}>
                Reiniciar su PIN
              </button>
              {guest.userId && (
                <button type="button" className={`${btn.ghost} mt-1 -ml-2.5`} onClick={() => setConfirm('sessions')}>
                  Cerrar sus sesiones abiertas
                </button>
              )}
            </>
          )}
        </div>

        {isSuper && guest.userId && (
          <label className="block">
            <span className="mb-1 block font-medium">Rol</span>
            <select
              className={inputClass}
              value={role}
              disabled={busy === 'role'}
              onChange={(e) => changeRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              Los administradores moderan y ven los reportes. Los superadministradores además nombran administradores.
            </span>
          </label>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 pt-4">
          <button
            type="button"
            className={`${btn.ghost} !text-red-600`}
            disabled={role !== 'guest'}
            title={role !== 'guest' ? 'Primero hay que quitarle el rol de administrador' : undefined}
            onClick={() => setConfirm('delete')}
          >
            Eliminar invitado
          </button>
          <div className="flex gap-2">
            <button type="button" className={btn.secondary} onClick={onClose}>
              Cerrar
            </button>
            <button type="button" className={btn.primary} disabled={!changed || !name.trim() || busy !== null} onClick={save}>
              {busy === 'save' && <Loader2 size={16} className="animate-spin" />} Guardar
            </button>
          </div>
        </div>
      </div>

      {confirm === 'release' && (
        <ConfirmDialog
          title={`Reiniciar el PIN de ${guest.name}`}
          message="Sirve si se olvidó el PIN (o si otra persona se registró con su nombre): se borra el PIN y se cierran sus sesiones. La próxima vez que entre busca su nombre e inventa uno nuevo, aunque el registro esté cerrado. Sigue siendo la misma cuenta (perfil, matches y chats). Hacelo solo si confirmaste que es esa persona."
          confirmLabel="Reiniciar PIN"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await adminJson(`/api/admin/guests/${guest.id}/release`, { method: 'POST' })
            onChanged()
            notify('PIN reiniciado: ya puede inventar uno nuevo')
          }}
        />
      )}
      {confirm === 'sessions' && (
        <ConfirmDialog
          title={`Cerrar las sesiones de ${guest.name}`}
          message="Queda afuera en todos sus dispositivos. Puede volver a entrar con su enlace o su código; si querés que no pueda, generale un código nuevo."
          confirmLabel="Cerrar sesiones"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await adminJson(`/api/admin/guests/${guest.id}/revoke`, { method: 'POST' })
            notify('Sesiones cerradas')
          }}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title={`Eliminar a ${guest.name}`}
          message={
            <>
              <p>Ya no va a poder entrar y se borra todo lo suyo: perfil, fotos, comentarios, historias, matches y chats.</p>
              <p className="mt-2 font-medium text-red-700">Esto no se puede deshacer.</p>
            </>
          }
          confirmLabel="Eliminar"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await adminJson(`/api/admin/guests/${guest.id}`, { method: 'DELETE' })
            onChanged()
            notify('Invitado eliminado')
            onClose()
          }}
        />
      )}
    </Modal>
  )
}

function GuestsInner() {
  const { me } = useMe()
  const params = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [search, setSearch] = useState(query)
  const [page, setPage] = useState<Page | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [modal, setModal] = useState<'add' | 'import' | null>(null)
  const [editing, setEditing] = useState<AdminGuest | null>(null)
  const { show, toast } = useToast()

  // Espera un momento despues de escribir antes de buscar
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    adminJson<Page>(`/api/admin/guests?q=${encodeURIComponent(search)}`)
      .then((d) => {
        if (cancelled) return
        setError(null)
        setPage(d)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [search, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const loadMore = async () => {
    if (!page) return
    setLoadingMore(true)
    try {
      const d = await adminJson<Page>(`/api/admin/guests?q=${encodeURIComponent(search)}&offset=${page.guests.length}`)
      setPage({ ...d, guests: [...page.guests, ...d.guests] })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoadingMore(false)
    }
  }

  // Baja toda la lista (todas las paginas) con los codigos, para imprimir las invitaciones
  const exportAll = async () => {
    setExporting(true)
    try {
      const all: AdminGuest[] = []
      for (;;) {
        const d = await adminJson<Page>(`/api/admin/guests?offset=${all.length}`)
        all.push(...d.guests)
        if (d.guests.length === 0 || all.length >= d.total) break
      }
      downloadCsv('invitados.csv', [
        ['name', 'email', 'side'],
        ...all.map((g) => [g.name, hasRealEmail(g.email) ? g.email : '', g.side ?? '']),
      ])
      show(`${all.length} invitados descargados`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  const guests = page?.guests ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className={`${inputClass} pl-9`}
            type="search"
            placeholder="Buscar por nombre o email"
            aria-label="Buscar invitados"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className={btn.primary} onClick={() => setModal('add')}>
          <Plus size={16} /> Agregar
        </button>
        <button type="button" className={btn.secondary} onClick={() => setModal('import')}>
          <Upload size={15} /> Importar CSV
        </button>
        <button type="button" className={btn.secondary} onClick={exportAll} disabled={exporting}>
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Descargar lista
        </button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!page && !error && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {page && (
        <p className="text-sm text-neutral-500" aria-live="polite">
          {page.total} {page.total === 1 ? 'invitado' : 'invitados'}
          {search && ` para “${search}”`}
        </p>
      )}

      {page && guests.length === 0 && (
        <EmptyState>{search ? 'No hay invitados que coincidan.' : 'Todavía no cargaste invitados. Agregá uno o importá un CSV.'}</EmptyState>
      )}

      <ul className="space-y-2">
        {guests.map((g) => (
          <li key={g.id}>
            <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate font-medium">{g.name}</p>
                <p className="truncate text-sm text-neutral-500">{contactLabel(g.email)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {g.role && g.role !== 'guest' && <Badge tone="blue">{ROLE_LABELS[g.role]}</Badge>}
                {!g.userId ? (
                  <Badge>No entró</Badge>
                ) : !g.claimed ? (
                  <Badge tone="amber">Nombre liberado</Badge>
                ) : g.hasProfile ? (
                  <Badge tone="green">Perfil listo</Badge>
                ) : (
                  <Badge tone="amber">Sin perfil</Badge>
                )}
                <span className="text-xs text-neutral-500">{sideText(g.side)}</span>
              </div>
              <button type="button" className={btn.secondary} onClick={() => setEditing(g)} aria-label={`Editar a ${g.name}`}>
                Editar
              </button>
            </Card>
          </li>
        ))}
      </ul>

      {page && guests.length < page.total && (
        <div className="flex justify-center">
          <button type="button" className={btn.secondary} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Cargando…' : `Cargar más (${page.total - guests.length})`}
          </button>
        </div>
      )}

      {modal === 'add' && <AddGuestModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={reload} />}
      {editing && (
        <EditGuestModal
          guest={editing}
          isSuper={me?.role === 'superadmin'}
          onClose={() => setEditing(null)}
          onChanged={reload}
          notify={show}
        />
      )}
      {toast}
    </div>
  )
}

export default function AdminGuestsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <GuestsInner />
    </Suspense>
  )
}
