// Matematica del recorte de fotos (sin DOM, para poder probarla). Todo en pixeles de la foto de origen.
//
// Modelo: la foto de origen tiene un tamano (w x h). El marco de recorte tiene una proporcion fija
// (ancho / alto). Con zoom 1 el recorte es el rectangulo MAS GRANDE de esa proporcion que entra en la foto
// (no queda ningun borde vacio); con mas zoom el recorte se achica. El centro se puede mover, siempre
// dentro de la foto.

export type Size = { w: number; h: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Center = { x: number; y: number }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

// "Original" mantiene la proporcion de la foto, pero acotada: una panoramica o una tira muy larga
// no tiene sentido como publicacion o historia
export const ORIGINAL_MIN_ASPECT = 9 / 16
export const ORIGINAL_MAX_ASPECT = 2

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export const aspectOf = (s: Size) => s.w / s.h

// Proporcion del marco cuando se elige "Original"
export const originalAspect = (src: Size) => clamp(aspectOf(src), ORIGINAL_MIN_ASPECT, ORIGINAL_MAX_ASPECT)

// El recorte mas grande de esa proporcion que entra en la foto
export const baseCrop = (src: Size, aspect: number): Size =>
  aspectOf(src) > aspect ? { w: src.h * aspect, h: src.h } : { w: src.w, h: src.w / aspect }

// Rectangulo de recorte para un zoom y un centro. El centro se corrige para no salirse de la foto.
export const cropRect = (src: Size, aspect: number, zoom: number, center: Center): Rect => {
  const base = baseCrop(src, aspect)
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const w = base.w / z
  const h = base.h / z
  return {
    x: clamp(center.x - w / 2, 0, src.w - w),
    y: clamp(center.y - h / 2, 0, src.h - h),
    w,
    h,
  }
}

export const centerOf = (r: Rect): Center => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

// Mueve el recorte lo que se arrastro el dedo en la pantalla (dx, dy en pixeles de pantalla): arrastrar
// hacia la derecha muestra lo que estaba a la izquierda, por eso el centro se mueve al reves.
export const panCenter = (rect: Rect, frame: Size, dxScreen: number, dyScreen: number): Center => ({
  x: rect.x + rect.w / 2 - dxScreen * (rect.w / frame.w),
  y: rect.y + rect.h / 2 - dyScreen * (rect.h / frame.h),
})

// Lo maximo que se sube. Es el mismo limite que aplica el servidor (app/api/profiles/photo): si el editor ya
// entrega la foto dentro de esta caja, el servidor no la vuelve a achicar (una sola pasada = mejor calidad).
export const MAX_UPLOAD: Size = { w: 1440, h: 1920 }

// Tamano final de la imagen que se sube: el del recorte, achicado hasta entrar en la caja `max`. NUNCA se agranda:
// una foto chica sale chica (agrandarla solo la volveria borrosa y mas pesada).
export const outputSize = (rect: Rect, max: Size = MAX_UPLOAD): Size => {
  const scale = Math.min(1, max.w / rect.w, max.h / rect.h)
  return { w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) }
}

// Foto con pocos pixeles para el uso que se le va a dar: se avisa antes de subirla
export const isLowRes = (rect: Rect, minLongSide: number) => Math.max(rect.w, rect.h) < minLongSide

// Tamano de la foto despues de girarla (cada giro es de 90 grados)
export const rotatedSize = (src: Size, quarterTurns: number): Size => (quarterTurns % 2 === 0 ? src : { w: src.h, h: src.w })
