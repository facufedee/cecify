import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coupleTitle, coupleInitials, sideLabels } from '@/lib/profile-schema'
import { forgetWeddingCode, readWeddingCode, rememberWeddingCode, shareLink, WEDDING_CODE_KEY } from '@/lib/wedding-client'

describe('etiquetas de lado con los nombres del casamiento', () => {
  it('partnerA es el lado bride y partnerB el groom; "los dos" no cambia', () => {
    expect(sideLabels({ partnerA: 'Ana', partnerB: 'Bruno' })).toEqual({
      bride: 'Del lado de Ana',
      groom: 'Del lado de Bruno',
      both: 'De los dos',
    })
  })

  it('sin nombres (cargando o error) usa textos neutros', () => {
    const fallback = sideLabels(null)
    expect(fallback.bride).toBe('Del lado de la novia')
    expect(fallback.groom).toBe('Del lado del novio')
    expect(fallback.both).toBe('De los dos')
  })

  it('un nombre vacio usa el texto neutro solo de ese lado', () => {
    expect(sideLabels({ partnerA: '  ', partnerB: ' Bruno ' })).toMatchObject({
      bride: 'Del lado de la novia',
      groom: 'Del lado de Bruno',
    })
  })

  it('titulo e iniciales de la pareja', () => {
    expect(coupleTitle({ partnerA: 'Ana', partnerB: 'Bruno' })).toBe('Ana & Bruno')
    expect(coupleTitle(null)).toBeNull()
    expect(coupleInitials({ partnerA: 'ana', partnerB: 'Bruno' })).toBe('AB')
    expect(coupleInitials(null)).toBe('♥')
  })
})

describe('link para compartir', () => {
  it('arma origen/c/CODIGO sin barras de mas', () => {
    expect(shareLink('https://lovify.app/', 'AB3K7M')).toBe('https://lovify.app/c/AB3K7M')
    expect(shareLink('https://lovify.app', 'AB3K7M')).toBe('https://lovify.app/c/AB3K7M')
  })
})

describe('codigo guardado en el celular', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('guarda el codigo normalizado y lo devuelve', () => {
    expect(rememberWeddingCode(' ab3-k7m ')).toBe('AB3K7M')
    expect(store.get(WEDDING_CODE_KEY)).toBe('AB3K7M')
    expect(readWeddingCode()).toBe('AB3K7M')
  })

  it('un codigo mal formado no se guarda (y no pisa el anterior)', () => {
    rememberWeddingCode('AB3K7M')
    expect(rememberWeddingCode('OOOOOO')).toBeNull()
    expect(rememberWeddingCode('')).toBeNull()
    expect(readWeddingCode()).toBe('AB3K7M')
  })

  it('ignora lo guardado si esta roto, y se puede olvidar', () => {
    store.set(WEDDING_CODE_KEY, 'basura!')
    expect(readWeddingCode()).toBeNull()
    rememberWeddingCode('AB3K7M')
    forgetWeddingCode()
    expect(readWeddingCode()).toBeNull()
  })

  it('sin localStorage (modo privado) no rompe', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readWeddingCode()).toBeNull()
    expect(rememberWeddingCode('AB3K7M')).toBe('AB3K7M')
    expect(() => forgetWeddingCode()).not.toThrow()
  })
})
