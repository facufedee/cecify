'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// QR generado en el navegador (el contenido nunca sale de la pagina). Devuelve un SVG que escala solo.
export default function Qr({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1f3d2a', light: '#ffffff' } })
      .then((s) => !cancelled && setSvg(s))
      .catch(() => !cancelled && setSvg(null))
    return () => {
      cancelled = true
    }
  }, [text])

  return (
    <div
      role="img"
      aria-label={label}
      className={`aspect-square [&>svg]:h-full [&>svg]:w-full ${className}`}
      // El SVG lo genera la libreria a partir de nuestro propio texto
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  )
}
