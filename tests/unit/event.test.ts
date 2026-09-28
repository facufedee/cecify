import { describe, expect, it } from 'vitest'
import { contactLabel, hasRealEmail, instagramFromEventEmail, phoneFromEventEmail, prettyPhone } from '@/lib/event'

describe('emails internos', () => {
  it('reconoce los de WhatsApp e Instagram', () => {
    expect(phoneFromEventEmail('5491155551234@whatsapp.invalid')).toBe('5491155551234')
    expect(phoneFromEventEmail('ana@x.com')).toBeNull()
    expect(phoneFromEventEmail('x5491155551234@whatsapp.invalid')).toBeNull()
    expect(instagramFromEventEmail('ana.perez@instagram.invalid')).toBe('ana.perez')
    expect(instagramFromEventEmail(null)).toBeNull()
  })

  it('solo es email de verdad el que se le puede escribir', () => {
    expect(hasRealEmail('ana@x.com')).toBe(true)
    expect(hasRealEmail('g-123@lista.invalid')).toBe(false)
    expect(hasRealEmail('5491155551234@whatsapp.invalid')).toBe(false)
    expect(hasRealEmail(null)).toBe(false)
  })
})

describe('como se muestra en el panel', () => {
  it('el WhatsApp, el Instagram, el email o que no tiene', () => {
    expect(prettyPhone('5491155551234')).toBe('+54 9 11 5555-1234')
    expect(contactLabel('5491155551234@whatsapp.invalid')).toBe('WhatsApp +54 9 11 5555-1234')
    expect(contactLabel('ana.perez@instagram.invalid')).toBe('Instagram @ana.perez')
    expect(contactLabel('ana@x.com')).toBe('ana@x.com')
    expect(contactLabel(null)).toBe('Sin email (de la lista)')
    expect(contactLabel('g-123@lista.invalid')).toBe('Sin email (de la lista)')
  })
})
