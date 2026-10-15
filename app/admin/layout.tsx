'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Clock,
  HeartHandshake,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldAlert,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import MeProvider, { useMe } from '@/components/app/MeProvider'
import MobileDrawer from '@/components/admin/MobileDrawer'
import { Spinner } from '@/components/admin/ui'
import { clearToken, getToken } from '@/lib/client-auth'
import { coupleTitle } from '@/lib/profile-schema'
import { ROLE_LABELS, isAdminRole } from '@/lib/roles'
import { useWedding } from '@/lib/wedding-client'

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', Icon: LayoutDashboard, exact: true },
  { href: '/admin/wedding', label: 'Casamiento', Icon: HeartHandshake },
  { href: '/admin/guests', label: 'Invitados', Icon: Users },
  { href: '/admin/event', label: 'Registro & Horarios', Icon: Clock },
  { href: '/admin/reports', label: 'Reportes', Icon: ShieldAlert },
  { href: '/admin/content', label: 'Muro & Contenido', Icon: ImageIcon },
]

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { me } = useMe()
  const wedding = useWedding()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Los links del menu lo cierran al navegar (en escritorio no hace nada)
  const closeMenu = () => setMobileOpen(false)

  useEffect(() => {
    if (!getToken()) router.replace('/login/admin')
  }, [router])

  const logout = () => {
    clearToken()
    router.replace('/login/admin')
  }

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

  const weddingName = coupleTitle(wedding)

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-6">
        {/* Brand header */}
        <div className="flex items-center justify-between px-1">
          <Link href="/admin" onClick={closeMenu} className="flex items-center gap-2.5 transition hover:opacity-90">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/logo-mark.png" alt="" className="h-9 w-9 object-contain" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-neutral-900">Lovify APP</span>
                <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Admin</span>
              </div>
              <p className="text-[11px] text-neutral-500">Gestión de eventos</p>
            </div>
          </Link>
          {mobileOpen && (
            <button
              type="button"
              onClick={closeMenu}
              aria-label="Cerrar menú"
              className="rounded-lg p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 md:hidden transition"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Casamiento activo Card */}
        <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/80 p-3 text-xs">
          <div className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1 font-semibold text-neutral-700">
              <Sparkles size={12} className="text-brand" /> Evento
            </span>
            {wedding?.code && (
              <span className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold tracking-wider text-neutral-800">
                {wedding.code}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate font-medium text-neutral-900">
            {weddingName || 'Sin casamiento asignado'}
          </p>
          <Link
            href="/admin/wedding"
            onClick={closeMenu}
            className="mt-2 block text-center font-medium text-brand hover:underline text-[11px]"
          >
            Configurar evento →
          </Link>
        </div>

        {/* Navegación principal */}
        <nav aria-label="Navegación del panel" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            const Icon = item.Icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-medium transition ${
                  active
                    ? 'bg-brand text-white shadow-sm font-semibold'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Footer del sidebar */}
      <div className="space-y-2 border-t border-neutral-200/80 pt-4">
        {/* Usuario conectado */}
        <div className="flex items-center gap-2.5 px-2 py-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200 text-neutral-700">
            <UserRound size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-neutral-900">
              {ROLE_LABELS[me.role]}
            </p>
            <p className="truncate text-[10px] text-neutral-500 uppercase tracking-wider">
              Panel de control
            </p>
          </div>
        </div>

        <div className="space-y-0.5 pt-1">
          <Link
            href="/admin/account"
            onClick={closeMenu}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition"
          >
            <UserRound size={15} />
            <span>Mi cuenta y contraseña</span>
          </Link>
          <Link
            href="/discover"
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition"
          >
            <ArrowLeft size={15} />
            <span>Ver app de invitados</span>
          </Link>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition"
          >
            <LogOut size={15} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-800">
      {/* Sidebar fijo en escritorio */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-neutral-200/80 bg-white md:flex md:flex-col print:hidden">
        {sidebarContent}
      </aside>

      {/* Topbar móvil */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden print:hidden">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            className="rounded-lg p-1.5 text-neutral-700 hover:bg-neutral-100 transition active:scale-95"
          >
            <Menu size={22} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/logo-mark.png" alt="" className="h-7 w-7 object-contain" />
          <span className="font-bold text-neutral-900">Lovify APP</span>
          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">Admin</span>
        </div>

        <div className="flex items-center gap-2">
          {weddingName && (
            <span className="max-w-[140px] truncate rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
              {weddingName}
            </span>
          )}
          <Link
            href="/admin/account"
            aria-label="Mi cuenta"
            className="rounded-lg p-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            <UserRound size={18} />
          </Link>
        </div>
      </header>

      {/* Drawer deslizante para móvil */}
      {mobileOpen && <MobileDrawer onClose={closeMenu}>{sidebarContent}</MobileDrawer>}

      {/* Contenido principal desplazado por el sidebar en escritorio */}
      <div className="md:pl-64 flex flex-col min-h-dvh">
        <main className="mx-auto w-full max-w-5xl px-4 py-6 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
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
