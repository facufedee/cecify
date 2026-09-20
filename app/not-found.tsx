import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-8 text-center text-neutral-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/logo-mark.png" alt="" className="h-16 w-auto" />
      <h1 className="mt-4 text-xl font-semibold">No encontramos esta página</h1>
      <p className="mt-1 text-sm text-neutral-500">Puede que el enlace esté mal escrito o que ya no exista.</p>
      <Link href="/" className="mt-6 rounded-2xl bg-brand px-6 py-2.5 text-sm font-medium text-white">
        Volver al inicio
      </Link>
    </main>
  )
}
