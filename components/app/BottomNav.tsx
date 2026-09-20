'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Heart, Image as ImageIcon, User } from 'lucide-react'
import { useRealtime } from '@/components/app/RealtimeProvider'

const ITEMS = [
  { href: '/discover', label: 'Descubrir', Icon: Compass },
  { href: '/matches', label: 'Matches', Icon: Heart },
  { href: '/photos', label: 'Fotos', Icon: ImageIcon },
  { href: '/profile', label: 'Perfil', Icon: User },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { unread } = useRealtime()

  // El chat y el composer de fotos ocupan toda la pantalla
  if (pathname.startsWith('/matches/') || pathname === '/photos/new') return null

  return (
    <nav className="flex border-t border-neutral-100 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || (href === '/photos' && pathname.startsWith('/photos/'))
        const badge = href === '/matches' && unread > 0 ? unread : 0
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
              active ? 'text-brand' : 'text-neutral-400 hover:text-neutral-600'
            }`}
          >
            <span className="relative">
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              {badge > 0 && (
                <span
                  aria-label={`${badge} mensajes sin leer`}
                  className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                >
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
