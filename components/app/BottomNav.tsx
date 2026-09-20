'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Heart, Image as ImageIcon, User } from 'lucide-react'

const ITEMS = [
  { href: '/discover', label: 'Descubrir', Icon: Compass },
  { href: '/matches', label: 'Matches', Icon: Heart },
  { href: '/photos', label: 'Fotos', Icon: ImageIcon },
  { href: '/profile', label: 'Perfil', Icon: User },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="flex border-t border-neutral-100 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-medium transition-colors ${
              active ? 'text-brand' : 'text-neutral-400 hover:text-neutral-600'
            }`}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 2} />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
