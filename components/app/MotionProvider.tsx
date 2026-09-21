'use client'

import { MotionConfig } from 'framer-motion'

// Respeta "reducir movimiento" del sistema: framer-motion apaga las animaciones de transformacion
// (deslizamientos, escalas) y deja solo los cambios de opacidad.
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
