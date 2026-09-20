import { describe, expect, it } from 'vitest'
import { BIO_MAX, INTERESTS, validateProfileInput } from '@/lib/profile-schema'

const valid = {
  name: '  Ana  ',
  age: 30,
  bio: 'Hola',
  mainPhotoUrl: '/uploads/u/a.jpg',
  additionalPhotos: [],
  interests: ['Música', 'Baile'],
  contactMethods: { instagram: '@ana.perez', whatsapp: '+54 9 11 5555-1234' },
}

const error = (changes: Record<string, unknown>) => {
  const r = validateProfileInput({ ...valid, ...changes })
  return r.ok ? null : r.error
}

describe('validateProfileInput', () => {
  it('acepta un perfil valido y normaliza nombre, Instagram y WhatsApp', () => {
    const r = validateProfileInput(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.name).toBe('Ana')
      expect(r.data.contactMethods).toEqual({ instagram: 'ana.perez', whatsapp: '+5491155551234' })
    }
  })

  it('rechaza edades fuera de rango o no enteras', () => {
    expect(error({ age: 17 })).toMatch(/edad/i)
    expect(error({ age: 100 })).toMatch(/edad/i)
    expect(error({ age: 30.5 })).toMatch(/edad/i)
    expect(error({ age: '30' })).toMatch(/edad/i)
  })

  it('rechaza nombre vacio o muy largo y bio demasiado larga', () => {
    expect(error({ name: '   ' })).toBeTruthy()
    expect(error({ name: 'x'.repeat(101) })).toBeTruthy()
    expect(error({ bio: 'x'.repeat(BIO_MAX + 1) })).toMatch(/bio/i)
  })

  it('exige entre 1 y 8 intereses de la lista, sin repetir', () => {
    expect(error({ interests: [] })).toBeTruthy()
    expect(error({ interests: ['Hackear'] })).toBeTruthy()
    expect(error({ interests: ['Baile', 'Baile'] })).toBeTruthy()
    expect(error({ interests: INTERESTS.slice(0, 9) })).toBeTruthy()
    expect(error({ interests: INTERESTS.slice(0, 8) })).toBeNull()
  })

  it('exige al menos un contacto valido', () => {
    expect(error({ contactMethods: {} })).toMatch(/contacto/i)
    expect(error({ contactMethods: { whatsapp: 'abc' } })).toMatch(/whatsapp/i)
    expect(error({ contactMethods: { instagram: 'no valido!' } })).toMatch(/instagram/i)
    expect(error({ contactMethods: { instagram: 'solo_ig' } })).toBeNull()
  })

  it('exige foto principal y admite hasta 3 adicionales', () => {
    expect(error({ mainPhotoUrl: '' })).toMatch(/foto/i)
    expect(error({ additionalPhotos: ['a', 'b', 'c', 'd'] })).toMatch(/fotos/i)
    expect(error({ additionalPhotos: ['a', 'b', 'c'] })).toBeNull()
  })

  it('no revienta con basura', () => {
    expect(validateProfileInput(null).ok).toBe(false)
    expect(validateProfileInput('texto').ok).toBe(false)
    expect(validateProfileInput({ interests: 'Baile' }).ok).toBe(false)
  })
})
