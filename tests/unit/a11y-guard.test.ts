import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../tailwind.config'

// Protecciones baratas de accesibilidad: no reemplazan una auditoria con axe en el navegador, pero evitan
// que vuelvan los problemas que ya se corrigieron.

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const sources = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name)
    return statSync(path.join(ROOT, rel)).isDirectory() ? sources(rel) : rel.endsWith('.tsx') ? [rel] : []
  })
const TSX = [...sources('app'), ...sources('components')]

// ---- contraste (WCAG 2.x) ----
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, Record<string, string> | string>
const c = (group: string, key: string) => (colors[group] as Record<string, string>)[key]
const AA = 4.5

describe('paleta: pares de color usados en texto llegan a contraste AA (4,5:1)', () => {
  it.each([
    ['ig.muted sobre blanco', c('ig', 'muted'), '#ffffff'],
    ['ig.muted sobre el gris de las tarjetas (ig.soft)', c('ig', 'muted'), c('ig', 'soft')],
    ['ig.link (texto de enlaces) sobre blanco', c('ig', 'link'), '#ffffff'],
    ['texto blanco sobre ig.link (botones azules)', '#ffffff', c('ig', 'link')],
    ['texto blanco sobre el verde de la marca', '#ffffff', c('brand', 'DEFAULT')],
    ['verde oscuro sobre verde claro (brand-soft)', c('brand', 'dark'), c('brand', 'soft')],
    ['verde oscuro sobre beige (cream)', c('brand', 'dark'), c('cream', 'DEFAULT')],
    ['gris 500 (#737373) sobre blanco', '#737373', '#ffffff'],
    ['gris 600 (#525252) sobre beige (cream)', '#525252', c('cream', 'DEFAULT')],
  ])('%s', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA)
  })

  it('el gris 400 de Tailwind (#a3a3a3) NO alcanza: por eso no se usa como color de texto', () => {
    expect(contrast('#a3a3a3', '#ffffff')).toBeLessThan(AA)
  })
})

describe('codigo fuente', () => {
  it('ningun texto usa gris 300/400 (no llega a contraste AA sobre blanco)', () => {
    const offenders = TSX.flatMap((file) =>
      read(file)
        .split('\n')
        .map((line, i) => ({ file, n: i + 1, line }))
        .filter(({ line }) => /(?<![:\w-])text-(neutral|gray|slate|zinc)-(300|400)\b|placeholder:text-(neutral|gray)-(300|400)\b/.test(line))
        .map(({ file, n }) => `${file}:${n}`)
    )
    expect(offenders).toEqual([])
  })

  it('todo dialogo modal usa useDialog (foco, Tab atrapado, Escape) y declara aria-modal', () => {
    const dialogs = TSX.filter((f) => read(f).includes('role="dialog"'))
    expect(dialogs.length).toBeGreaterThanOrEqual(7)
    const bad = dialogs.filter((f) => {
      const s = read(f)
      return !s.includes('useDialog') || !s.includes('aria-modal="true"') || !s.includes('tabIndex={-1}')
    })
    expect(bad).toEqual([])
  })

  it('el zoom del navegador esta fijado a escala 1 para comportamiento de app nativa', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toMatch(/userScalable:\s*false/)
    expect(layout).toMatch(/maximumScale:\s*1/)
  })

  it('los estilos globales tienen foco visible, movimiento reducido y tema claro declarado', () => {
    const css = read('app/globals.css')
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/color-scheme:\s*light/)
    // sin colores de modo oscuro que dejen texto claro sobre las pantallas claras de la app
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/)
  })

  it('toda la app respeta "reducir movimiento" en framer-motion', () => {
    expect(read('app/layout.tsx')).toContain('MotionProvider')
    expect(read('components/app/MotionProvider.tsx')).toMatch(/reducedMotion="user"/)
  })

  it('el documento declara el idioma', () => {
    expect(read('app/layout.tsx')).toMatch(/<html lang="es">/)
  })
})
