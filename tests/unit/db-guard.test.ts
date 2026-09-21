import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

const sources = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.join(dir, name)
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sources(rel)
    return /\.tsx?$/.test(name) ? [rel.replaceAll('\\', '/')] : []
  })

describe('acceso a datos', () => {
  it('solo lib/db/core.ts y lib/storage.ts hablan con Supabase: el resto pasa por callFn', () => {
    const files = ['app', 'components', 'lib']
      .flatMap(sources)
      .filter((f) => /from '@\/lib\/supabase'/.test(readFileSync(path.join(ROOT, f), 'utf8')))
    expect(files.sort()).toEqual(['lib/db/core.ts', 'lib/storage.ts'])
  })

  it('los modulos de lib/db se mantienen chicos (uno por dominio)', () => {
    const big = sources('lib/db')
      .filter((f) => !/\/(admin|local)\.ts$/.test(f))
      .filter((f) => readFileSync(path.join(ROOT, f), 'utf8').split('\n').length > 300)
    expect(big).toEqual([])
  })
})
