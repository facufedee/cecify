'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, QrCode } from 'lucide-react'
import { useMe } from '@/components/app/MeProvider'
import { btn, Card, ErrorNote, inputClass, Spinner, useToast } from '@/components/admin/ui'
import ShareCode from '@/components/wedding/ShareCode'
import { authFetch } from '@/lib/client-auth'
import { setWeddingNames, useWedding } from '@/lib/wedding-client'
import { PARTNER_NAME_MAX, PARTNER_NAMES_ERROR, parsePartnerNames } from '@/lib/wedding-code'

// Formulario de nombres: arranca con los guardados (se vuelve a montar si cambian afuera)
function NamesForm({
  initial,
  editable,
  onReadOnly,
  onSaved,
}: {
  initial: { partnerA: string; partnerB: string }
  editable: boolean
  onReadOnly: () => void
  onSaved: () => void
}) {
  const [partnerA, setPartnerA] = useState(initial.partnerA)
  const [partnerB, setPartnerB] = useState(initial.partnerB)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const names = parsePartnerNames({ partnerA, partnerB })
  const changed = partnerA.trim() !== initial.partnerA || partnerB.trim() !== initial.partnerB

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!names) return
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch('/api/admin/wedding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(names),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403) return onReadOnly()
      if (!res.ok) return setError(data.error ?? 'No se pudieron guardar los nombres')
      setWeddingNames({ partnerA: data.partnerA ?? names.partnerA, partnerB: data.partnerB ?? names.partnerB })
      onSaved()
    } catch {
      setError('Sin conexión, probá de nuevo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre de uno</span>
          <input
            className={inputClass}
            value={partnerA}
            maxLength={PARTNER_NAME_MAX}
            readOnly={!editable}
            onChange={(e) => setPartnerA(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Nombre del otro</span>
          <input
            className={inputClass}
            value={partnerB}
            maxLength={PARTNER_NAME_MAX}
            readOnly={!editable}
            onChange={(e) => setPartnerB(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-neutral-500">
        Los invitados eligen «Del lado de {partnerA.trim() || '…'}» o «Del lado de {partnerB.trim() || '…'}».
      </p>
      {!names && <ErrorNote>{PARTNER_NAMES_ERROR}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {editable ? (
        <button type="submit" className={btn.primary} disabled={!names || !changed || busy}>
          {busy && <Loader2 size={16} className="animate-spin" />} Guardar nombres
        </button>
      ) : (
        <p className="text-xs text-neutral-500">Solo los dueños del casamiento (superadministradores) pueden cambiar los nombres.</p>
      )}
    </form>
  )
}

// El casamiento: nombres de los novios, codigo y link para compartir con los invitados
export default function AdminWeddingPage() {
  const { me } = useMe()
  const wedding = useWedding()
  const { show, toast } = useToast()
  const [forbidden, setForbidden] = useState(false)

  if (!wedding) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const editable = me?.role === 'superadmin' && !forbidden

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-base font-semibold">Los novios</h2>
          <p className="mt-1 text-sm text-neutral-600">Sus nombres aparecen en la entrada de los invitados, en los carteles con QR y en los perfiles.</p>
        </div>
        <NamesForm
          key={`${wedding.partnerA}\n${wedding.partnerB}`}
          initial={{ partnerA: wedding.partnerA, partnerB: wedding.partnerB }}
          editable={editable}
          onReadOnly={() => setForbidden(true)}
          onSaved={() => show('Nombres guardados')}
        />
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-base font-semibold">Código para los invitados</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Mandales el link (o el código) junto con la invitación. Cada invitado entra, busca su nombre en la lista y crea su PIN.
          </p>
        </div>
        {wedding.code ? <ShareCode code={wedding.code} /> : <ErrorNote>No se pudo cargar el código del casamiento</ErrorNote>}
        <Link href="/admin/event" className={btn.secondary}>
          <QrCode size={16} /> Imprimir carteles con QR
        </Link>
      </Card>

      {toast}
    </div>
  )
}
