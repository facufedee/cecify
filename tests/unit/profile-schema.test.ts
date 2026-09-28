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
  side: 'bride',
  wantsMatch: true,
  lookingFor: ['meet'],
  gender: 'woman',
  interestedIn: 'men',
  prefAgeMin: 25,
  prefAgeMax: 40,
}

const error = (changes: Record<string, unknown>) => {
  const r = validateProfileInput({ ...valid, ...changes })
  return r.ok ? null : r.error
}

describe('preferencias de match', () => {
  it('quien conoce gente tiene que decir quien es, a quien busca y el rango de edad', () => {
    expect(error({ gender: undefined })).toMatch(/identificás/)
    expect(error({ gender: 'otro' })).toMatch(/identificás/)
    expect(error({ interestedIn: undefined })).toMatch(/a quién/)
    expect(error({ prefAgeMin: 17 })).toMatch(/rango/)
    expect(error({ prefAgeMax: 100 })).toMatch(/rango/)
    expect(error({ prefAgeMin: 40, prefAgeMax: 30 })).toMatch(/rango/)
    expect(error({ prefAgeMin: 25.5 })).toMatch(/rango/)
    const r = validateProfileInput(valid)
    expect(r.ok && r.data).toMatchObject({ gender: 'woman', interestedIn: 'men', prefAgeMin: 25, prefAgeMax: 40 })
  })

  it('quien solo usa el muro no filtra: se descartan las preferencias', () => {
    const r = validateProfileInput({ ...valid, wantsMatch: false, lookingFor: [], interests: [], contactMethods: {} })
    expect(r.ok && r.data).toMatchObject({ gender: 'woman', interestedIn: null, prefAgeMin: 18, prefAgeMax: 99 })
    const sin = validateProfileInput({ ...valid, wantsMatch: false, gender: undefined, interestedIn: undefined })
    expect(sin.ok && sin.data.gender).toBeNull()
  })
})

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

  it('visible es true por defecto, acepta false y rechaza otros tipos', () => {
    const ok = validateProfileInput(valid)
    expect(ok.ok && ok.data.visible).toBe(true)
    const hidden = validateProfileInput({ ...valid, visible: false })
    expect(hidden.ok && hidden.data.visible).toBe(false)
    expect(error({ visible: 'no' })).toMatch(/visibilidad/i)
  })

  it('exige de parte de quien viene', () => {
    expect(error({ side: undefined })).toMatch(/parte de quién/i)
    expect(error({ side: 'otro' })).toMatch(/parte de quién/i)
    expect(error({ side: 'groom' })).toBeNull()
    expect(error({ side: 'both' })).toBeNull()
  })

  it('quien quiere hacer match tiene que elegir que busca (una o las dos, sin repetir)', () => {
    expect(error({ lookingFor: [] })).toMatch(/buscando/i)
    expect(error({ lookingFor: undefined })).toMatch(/buscando/i)
    expect(error({ lookingFor: ['casarse'] })).toMatch(/buscando/i)
    expect(error({ lookingFor: ['meet', 'meet'] })).toMatch(/buscando/i)
    expect(error({ lookingFor: ['dance'] })).toBeNull()
    expect(error({ lookingFor: ['meet', 'dance'] })).toBeNull()
  })

  it('wantsMatch es true por defecto y rechaza otros tipos', () => {
    const { wantsMatch: _omit, ...withoutMode } = valid
    void _omit
    const r = validateProfileInput(withoutMode)
    expect(r.ok && r.data.wantsMatch).toBe(true)
    expect(error({ wantsMatch: 'si' })).toMatch(/modo/i)
  })

  it('en modo "solo muro" no pide intereses, contacto ni que busca', () => {
    const social = { wantsMatch: false, interests: [], contactMethods: {}, lookingFor: [] }
    expect(error(social)).toBeNull()
    // aunque llegue algo de lookingFor, no se guarda
    const r = validateProfileInput({ ...valid, ...social, lookingFor: ['meet'] })
    expect(r.ok && r.data.lookingFor).toEqual([])
    // lo que se manda igual se valida
    expect(error({ ...social, interests: ['Hackear'] })).toBeTruthy()
    expect(error({ ...social, contactMethods: { whatsapp: 'abc' } })).toMatch(/whatsapp/i)
    // pero la foto, la edad y el lado siguen siendo obligatorios
    expect(error({ ...social, mainPhotoUrl: '' })).toMatch(/foto/i)
    expect(error({ ...social, side: undefined })).toMatch(/parte de quién/i)
  })

  it('no revienta con basura', () => {
    expect(validateProfileInput(null).ok).toBe(false)
    expect(validateProfileInput('texto').ok).toBe(false)
    expect(validateProfileInput({ interests: 'Baile' }).ok).toBe(false)
  })
})
