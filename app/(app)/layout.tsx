'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import BottomNav from '@/components/app/BottomNav'
import RealtimeProvider from '@/components/app/RealtimeProvider'
import { getToken } from '@/lib/client-auth'

// Marco de la app para invitados con sesion: contenido + barra de navegacion inferior
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    if (!getToken()) router.replace('/login')
  }, [router])

  return (
    <div className="min-h-dvh bg-cream sm:py-4">
      <div className="relative mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-white text-neutral-800 sm:h-[calc(100dvh-2rem)] sm:max-h-[54rem] sm:rounded-[2rem] sm:shadow-sm">
        <RealtimeProvider>
          <main className="min-h-0 flex-1">{children}</main>
          <BottomNav />
        </RealtimeProvider>
      </div>
    </div>
  )
}
