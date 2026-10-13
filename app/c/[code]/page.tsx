'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { forgetWeddingCode, rememberWeddingCode } from '@/lib/wedding-client'

// Link para compartir (/c/CODIGO): guarda el codigo del casamiento en el celular y lleva a la entrada.
export default function ShareLinkPage() {
  const router = useRouter()
  const params = useParams<{ code: string }>()

  useEffect(() => {
    let raw = ''
    try {
      raw = decodeURIComponent(params.code ?? '')
    } catch {}
    // Un link roto tampoco deja el casamiento anterior: /login pide el codigo de cero
    if (!rememberWeddingCode(raw)) forgetWeddingCode()
    router.replace('/login')
  }, [params.code, router])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#F5EFE0]">
      <Loader2 role="status" aria-label="Entrando" className="animate-spin text-[#4A7C59]" />
    </main>
  )
}
