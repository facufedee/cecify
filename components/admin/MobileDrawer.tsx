'use client'

import { useDialog } from '@/components/a11y/useDialog'

// Menu lateral del panel en el celular. Se monta solo mientras esta abierto, asi useDialog
// mueve el foco adentro, atrapa el Tab y cierra con Escape cada vez que se abre.
export default function MobileDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-40 md:hidden print:hidden">
      <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        tabIndex={-1}
        className="fixed inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-white shadow-2xl outline-none"
      >
        {children}
      </div>
    </div>
  )
}
