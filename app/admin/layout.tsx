'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, ShieldAlert, UserRound } from 'lucide-react'
import MeProvider, { useMe } from '@/components/app/MeProvider'
import { Spinner } from '@/components/admin/ui'
import { getToken } from '@/lib/client-auth'
import { ROLE_LABELS, isAdminRole } from '@/lib/roles'

const TABS = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/reports', label: 'Reportes' },
  { href: '/admin/guests', label: 'Invitados' },
  { href: '/admin/invitations', label: 'Invitaciones' },
  { href: '/admin/event', label: 'QR de la fiesta' },
  { href: '/admin/content', label: 'Contenido' },
]

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me } = useMe()

  useEffect(() => {
    if (!getToken()) router.replace('/login')
  }, [router])

  if (!me) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-50">
        <Spinner />
      </div>
    )
  }

  if (!isAdminRole(me.role)) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-neutral-50 px-6 text-center">
        <ShieldAlert size={36} className="text-neutral-500" />
        <h1 className="text-lg font-semibold">No tenés permiso para ver esta página</h1>
        <p className="max-w-sm text-sm text-neutral-500">El panel es solo para los administradores de la fiesta.</p>
        <Link href="/discover" className="text-sm font-medium text-brand">
          Volver a la app
        </Link>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-800">
      <header className="border-b border-neutral-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">CL</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight">Administración</h1>
            <p className="truncate text-xs text-neutral-500">
              Cecify · {ROLE_LABELS[me.role]}
            </p>
          </div>
          <Link
            href="/admin/account"
            aria-label="Mi cuenta"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            <UserRound size={16} /> <span className="hidden sm:inline">Mi cuenta</span>
          </Link>
          <Link href="/discover" className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
            <ArrowLeft size={16} /> <span className="hidden sm:inline">Volver a la app</span>
            <span className="sm:hidden">App</span>
          </Link>
        </div>
        <nav aria-label="Secciones" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3">
          {TABS.map((t) => {
            const active = t.href === '/admin' ? pathname === '/admin' : pathname.startsWith(t.href)
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  active ? 'border-brand text-brand' : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <MeProvider>
      <Shell>{children}</Shell>
    </MeProvider>
  )
}
