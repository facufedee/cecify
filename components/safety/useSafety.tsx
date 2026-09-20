'use client'

import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import ReportSheet from '@/components/safety/ReportSheet'
import ActionSheet from '@/components/wall/ActionSheet'
import { authFetch } from '@/lib/client-auth'

// A quien va dirigida la accion. Descubrir solo conoce el id de perfil; el resto, el id de usuario.
export type SafetyTarget = { name: string; userId?: string; profileId?: string }

export type ReportTarget = SafetyTarget & {
  type: 'profile' | 'photo' | 'comment' | 'story' | 'chat'
  targetId?: string // foto, historia o comentario
  conversationId?: string // para reportar un chat
  photoId?: string // para reportar un comentario
}

// Reportar, bloquear y deshacer match, con sus confirmaciones. Cada pantalla decide que hacer
// despues (por ejemplo, sacar las fotos del bloqueado del feed) con los callbacks.
export function useSafety(
  opts: {
    onBlocked?: (target: SafetyTarget) => void
    onUnmatched?: (conversationId: string) => void
  } = {}
) {
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [block, setBlock] = useState<SafetyTarget | null>(null)
  const [unmatch, setUnmatch] = useState<{ conversationId: string; name: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const say = (message: string) => {
    setNotice(message)
    setTimeout(() => setNotice(null), 3500)
  }

  const doBlock = async (target: SafetyTarget) => {
    setBlock(null)
    setReport(null)
    try {
      const res = await authFetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: target.userId, profileId: target.profileId }),
      })
      if (!res.ok) throw new Error()
      say(`Bloqueaste a ${target.name}`)
      opts.onBlocked?.(target)
    } catch {
      say('No se pudo bloquear, probá de nuevo')
    }
  }

  const doUnmatch = async (conversationId: string, name: string) => {
    setUnmatch(null)
    try {
      const res = await authFetch(`/api/matches/${conversationId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      say(`Deshiciste el match con ${name}`)
      opts.onUnmatched?.(conversationId)
    } catch {
      say('No se pudo deshacer el match')
    }
  }

  const overlays = (
    <>
      <AnimatePresence>
        {report && (
          <ReportSheet
            key="report"
            target={report}
            onClose={() => setReport(null)}
            onBlock={() => setBlock(report)}
          />
        )}
        {block && (
          <ActionSheet
            key="block"
            title={`¿Bloquear a ${block.name}?`}
            message="No van a poder verse en Descubrir, el muro ni las historias, y se deshace el match si lo hay. No se le avisa."
            onClose={() => setBlock(null)}
            actions={[{ label: 'Bloquear', destructive: true, onClick: () => doBlock(block) }]}
          />
        )}
        {unmatch && (
          <ActionSheet
            key="unmatch"
            title={`¿Deshacer el match con ${unmatch.name}?`}
            message="Se borra la conversación para los dos y no van a volver a aparecer en Descubrir."
            onClose={() => setUnmatch(null)}
            actions={[
              { label: 'Deshacer match', destructive: true, onClick: () => doUnmatch(unmatch.conversationId, unmatch.name) },
            ]}
          />
        )}
      </AnimatePresence>
      {notice && (
        <p
          role="status"
          className="absolute inset-x-6 bottom-20 z-[60] rounded-xl bg-ig-text px-4 py-2.5 text-center text-sm text-white shadow-lg"
        >
          {notice}
        </p>
      )}
    </>
  )

  return {
    busy: Boolean(report || block || unmatch), // hay un dialogo abierto (p. ej. para pausar historias)
    openReport: (target: ReportTarget) => setReport(target),
    openBlock: (target: SafetyTarget) => setBlock(target),
    openUnmatch: (conversationId: string, name: string) => setUnmatch({ conversationId, name }),
    overlays,
  }
}
