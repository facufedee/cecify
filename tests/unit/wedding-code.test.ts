import { describe, expect, it } from 'vitest'
import { parseNewWedding, parsePartnerNames, parseWeddingCode } from '@/lib/wedding-code'

describe('codigo del casamiento', () => {
  it('acepta lo que escribe la gente: minusculas, espacios y guiones', () => {
    expect(parseWeddingCode('AB3K7M')).toBe('AB3K7M')
    expect(parseWeddingCode('ab3 k7m')).toBe('AB3K7M')
    expect(parseWeddingCode(' ab3-k7m ')).toBe('AB3K7M')
  })

  it('sin codigo (la app de antes) es undefined, no un error', () => {
    expect(parseWeddingCode(undefined)).toBeUndefined()
    expect(parseWeddingCode(null)).toBeUndefined()
    expect(parseWeddingCode('')).toBeUndefined()
    expect(parseWeddingCode('  ')).toBeUndefined()
  })

  it('rechaza (null) codigos mal formados', () => {
    expect(parseWeddingCode('AB3K7')).toBeNull() // corto
    expect(parseWeddingCode('AB3K7MX')).toBeNull() // largo
    expect(parseWeddingCode('AB0K7M')).toBeNull() // 0 es ambiguo
    expect(parseWeddingCode('ABOK7M')).toBeNull() // O tambien
    expect(parseWeddingCode('AB1K7M')).toBeNull()
    expect(parseWeddingCode('ABIK7M')).toBeNull()
    expect(parseWeddingCode('ABLK7M')).toBeNull()
    expect(parseWeddingCode('AB_K7M')).toBeNull()
    expect(parseWeddingCode(123456)).toBeNull()
    expect(parseWeddingCode({})).toBeNull()
    expect(parseWeddingCode('A'.repeat(500))).toBeNull()
  })
})

describe('nombres de la pareja', () => {
  it('recorta espacios y acepta de 1 a 60 caracteres', () => {
    expect(parsePartnerNames({ partnerA: ' Ana ', partnerB: 'Beto' })).toEqual({ partnerA: 'Ana', partnerB: 'Beto' })
    expect(parsePartnerNames({ partnerA: 'Ñ'.repeat(60), partnerB: 'B' })).toEqual({ partnerA: 'Ñ'.repeat(60), partnerB: 'B' })
  })

  it('cuenta caracteres como Postgres (un emoji es uno)', () => {
    expect(parsePartnerNames({ partnerA: '💍'.repeat(60), partnerB: 'B' })).not.toBeNull()
  })

  it('rechaza vacios, largos o que no son texto', () => {
    expect(parsePartnerNames({ partnerA: '  ', partnerB: 'B' })).toBeNull()
    expect(parsePartnerNames({ partnerA: 'A', partnerB: 'x'.repeat(61) })).toBeNull()
    expect(parsePartnerNames({ partnerA: 'A' })).toBeNull()
    expect(parsePartnerNames({ partnerA: 1, partnerB: 'B' })).toBeNull()
    expect(parsePartnerNames(null)).toBeNull()
  })
})

describe('alta de un casamiento', () => {
  const valid = { partnerA: 'Ana', partnerB: 'Beto', username: ' Ana.Beto ', password: 'una clave larga' }

  it('normaliza el usuario igual que el login de organizadores', () => {
    expect(parseNewWedding(valid)).toEqual({
      ok: true,
      value: { partnerA: 'Ana', partnerB: 'Beto', username: 'ana.beto', password: 'una clave larga' },
    })
  })

  it('explica que esta mal', () => {
    expect(parseNewWedding({ ...valid, partnerB: '' })).toEqual({ ok: false, error: expect.stringMatching(/nombres/) })
    expect(parseNewWedding({ ...valid, username: 'ab' })).toEqual({ ok: false, error: expect.stringMatching(/usuario/) })
    expect(parseNewWedding({ ...valid, username: 'con espacio' })).toEqual({ ok: false, error: expect.stringMatching(/usuario/) })
    expect(parseNewWedding({ ...valid, password: 'corta' })).toEqual({ ok: false, error: expect.stringMatching(/al menos 8/) })
    expect(parseNewWedding({ ...valid, password: 'x'.repeat(201) })).toEqual({ ok: false, error: expect.stringMatching(/larga/) })
    expect(parseNewWedding(null).ok).toBe(false)
  })
})
