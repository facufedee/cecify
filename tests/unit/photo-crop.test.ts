import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_UPLOAD,
  ORIGINAL_MAX_ASPECT,
  ORIGINAL_MIN_ASPECT,
  baseCrop,
  centerOf,
  cropRect,
  isLowRes,
  originalAspect,
  outputSize,
  panCenter,
  rotatedSize,
} from '@/lib/photo-crop'

const inside = (r: { x: number; y: number; w: number; h: number }, s: { w: number; h: number }) =>
  r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= s.w + 1e-9 && r.y + r.h <= s.h + 1e-9

describe('baseCrop: el recorte mas grande de esa proporcion', () => {
  it('foto horizontal con marco vertical: usa todo el alto', () => {
    expect(baseCrop({ w: 4000, h: 3000 }, 4 / 5)).toEqual({ w: 2400, h: 3000 })
  })
  it('foto vertical con marco horizontal: usa todo el ancho', () => {
    const b = baseCrop({ w: 3000, h: 4000 }, 16 / 9)
    expect(b.w).toBe(3000)
    expect(b.h).toBeCloseTo(1687.5)
  })
  it('misma proporcion: es la foto entera', () => {
    expect(baseCrop({ w: 800, h: 1000 }, 4 / 5)).toEqual({ w: 800, h: 1000 })
  })
})

describe('originalAspect', () => {
  it('conserva la proporcion de la foto', () => {
    expect(originalAspect({ w: 4000, h: 3000 })).toBeCloseTo(4 / 3)
    expect(originalAspect({ w: 165, h: 174 })).toBeCloseTo(165 / 174)
  })
  it('acota las muy alargadas (panoramicas y tiras)', () => {
    expect(originalAspect({ w: 8000, h: 1000 })).toBe(ORIGINAL_MAX_ASPECT)
    expect(originalAspect({ w: 500, h: 4000 })).toBe(ORIGINAL_MIN_ASPECT)
  })
})

describe('cropRect', () => {
  const src = { w: 4000, h: 3000 }

  it('zoom 1 con "Original" es la foto entera (sin recortar nada)', () => {
    const r = cropRect(src, originalAspect(src), 1, { x: 2000, y: 1500 })
    expect(r).toEqual({ x: 0, y: 0, w: 4000, h: 3000 })
  })

  it('con mas zoom el recorte se achica y sigue centrado donde se pidio', () => {
    const r = cropRect(src, 4 / 3, 2, { x: 1000, y: 1000 })
    expect(r.w).toBeCloseTo(2000)
    expect(r.h).toBeCloseTo(1500)
    expect(centerOf(r)).toEqual({ x: 1000, y: 1000 })
  })

  it('el centro se corrige: nunca se sale de la foto, ni con zoom extremo ni pidiendo un centro imposible', () => {
    for (const zoom of [1, 1.5, 3, 4, 99, -5]) {
      for (const center of [{ x: -500, y: -500 }, { x: 9999, y: 9999 }, { x: 0, y: 3000 }, { x: 2000, y: 1500 }]) {
        expect(inside(cropRect(src, 4 / 5, zoom, center), src)).toBe(true)
      }
    }
  })

  it('el zoom se limita entre 1 y 4', () => {
    expect(cropRect(src, 4 / 3, 99, { x: 2000, y: 1500 }).w).toBeCloseTo(1000)
    expect(cropRect(src, 4 / 3, 0.2, { x: 2000, y: 1500 }).w).toBeCloseTo(4000)
  })

  it('la proporcion del recorte es siempre la del marco', () => {
    for (const aspect of [9 / 16, 4 / 5, 1, 16 / 9]) {
      const r = cropRect(src, aspect, 2.3, { x: 1234, y: 987 })
      expect(r.w / r.h).toBeCloseTo(aspect, 6)
    }
  })
})

describe('panCenter', () => {
  it('arrastrar a la derecha muestra lo que estaba a la izquierda (el centro va a la izquierda)', () => {
    const rect = { x: 1000, y: 500, w: 2000, h: 1500 }
    const c = panCenter(rect, { w: 400, h: 300 }, 40, 0) // el marco mide 400 px y la foto 2000 -> 5 px de foto por px
    expect(c.x).toBeCloseTo(2000 - 200)
    expect(c.y).toBeCloseTo(1250)
  })
  it('arrastrar hacia abajo mueve el centro hacia arriba', () => {
    const rect = { x: 0, y: 1000, w: 2000, h: 1500 }
    expect(panCenter(rect, { w: 400, h: 300 }, 0, 20).y).toBeCloseTo(1750 - 100)
  })
})

describe('outputSize', () => {
  it('achica lo que pasa de la caja maxima (1440 x 1920), manteniendo la proporcion', () => {
    expect(outputSize({ x: 0, y: 0, w: 4000, h: 3000 })).toEqual({ w: 1440, h: 1080 }) // manda el ancho
    expect(outputSize({ x: 0, y: 0, w: 3000, h: 4000 })).toEqual({ w: 1440, h: 1920 }) // entra justo
    expect(outputSize({ x: 0, y: 0, w: 2000, h: 6000 })).toEqual({ w: 640, h: 1920 }) // manda el alto
  })
  it('una historia 9:16 de 1080x1920 no se achica nada', () => {
    expect(outputSize({ x: 0, y: 0, w: 1080, h: 1920 })).toEqual({ w: 1080, h: 1920 })
  })
  it('NUNCA agranda: una foto chica sale chica', () => {
    expect(outputSize({ x: 0, y: 0, w: 165, h: 174 })).toEqual({ w: 165, h: 174 })
  })
  it('acepta otra caja', () => {
    expect(outputSize({ x: 0, y: 0, w: 4000, h: 3000 }, { w: 1000, h: 1000 })).toEqual({ w: 1000, h: 750 })
  })
  it('nunca da 0', () => {
    expect(outputSize({ x: 0, y: 0, w: 0.2, h: 0.2 })).toEqual({ w: 1, h: 1 })
  })
})

describe('isLowRes y rotatedSize', () => {
  it('avisa cuando el lado mayor del recorte es menor al minimo', () => {
    expect(isLowRes({ x: 0, y: 0, w: 222, h: 178 }, 600)).toBe(true)
    expect(isLowRes({ x: 0, y: 0, w: 900, h: 700 }, 600)).toBe(false)
  })
  it('un giro de 90 grados intercambia ancho y alto', () => {
    expect(rotatedSize({ w: 400, h: 300 }, 1)).toEqual({ w: 300, h: 400 })
    expect(rotatedSize({ w: 400, h: 300 }, 2)).toEqual({ w: 400, h: 300 })
    expect(rotatedSize({ w: 400, h: 300 }, 3)).toEqual({ w: 300, h: 400 })
  })
})

describe('el servidor y el editor comparten el limite de subida', () => {
  it('app/api/profiles/photo achica a la misma caja que MAX_UPLOAD (asi la foto se remuestrea una sola vez)', () => {
    const route = readFileSync(path.join(process.cwd(), 'app/api/profiles/photo/route.ts'), 'utf8')
    expect(route).toContain(`const MAX_WIDTH = ${MAX_UPLOAD.w}`)
    expect(route).toContain(`const MAX_HEIGHT = ${MAX_UPLOAD.h}`)
    // y nunca recorta ni agranda
    expect(route).toContain("fit: 'inside'")
    expect(route).toContain('withoutEnlargement: true')
  })
})
