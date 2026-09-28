import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import MotionProvider from '@/components/app/MotionProvider'
import RegisterServiceWorker from '@/components/app/RegisterServiceWorker'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Cecify - Lucas & Cecilia',
  description: 'Conocé a los invitados, chateá y compartí las fotos de la boda',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cecify',
  },
  icons: {
    icon: [
      { url: '/icons/favicon.ico', sizes: 'any' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#4A7C59',
  // Con el teclado abierto, Android achica la pagina en vez de empujarla hacia arriba (el chat no pierde el encabezado)
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <RegisterServiceWorker />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}
