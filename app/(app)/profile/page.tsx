'use client'

import { useRouter } from 'next/navigation'
import { clearToken } from '@/lib/client-auth'

export default function ProfilePage() {
  const router = useRouter()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-neutral-500">
      <p>Tu perfil: próximamente</p>
      <button
        type="button"
        onClick={() => {
          clearToken()
          router.replace('/login')
        }}
        className="rounded-xl border border-neutral-200 px-5 py-2 text-sm font-medium text-neutral-700"
      >
        Cerrar sesión
      </button>
    </div>
  )
}
