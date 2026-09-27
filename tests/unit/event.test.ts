import { describe, expect, it } from 'vitest'
import {
  canonicalInstagram,
  canonicalPhone,
  contactLabel,
  eventEmail,
  eventJoinUrl,
  instagramEmail,
  instagramFromEventEmail,
  isEventEmail,
  parseEventHash,
  phoneFromEventEmail,
  prettyPhone,
} from '@/lib/event'

describe('canonicalPhone', () => {
  it('el mismo celular argentino escrito de distintas formas da el mismo numero (la misma cuenta)', () => {
    for (const raw of ['11 5555-1234', '+54 11 5555 1234', '+54 9 11 5555-1234', '5491155551234', '0054 9 11 5555 1234', '(11) 5555.1234']) {
      expect(canonicalPhone(raw), raw).toBe('5491155551234')
    }
    expect(canonicalPhone('351 555 1234')).toBe('5493515551234')
  })

  it('los de otros paises quedan como vienen', () => {
    expect(canonicalPhone('+34 612 345 678')).toBe('34612345678')
    expect(canonicalPhone('+1 (415) 555-2671')).toBe('14155552671')
  })

  it('rechaza lo que no es un telefono', () => {
    expect(canonicalPhone('')).toBeNull()
    expect(canonicalPhone('1234')).toBeNull()
    expect(canonicalPhone('hola')).toBeNull()
    expect(canonicalPhone('1'.repeat(16))).toBeNull()
  })
})

describe('canonicalInstagram', () => {
  it('el mismo usuario escrito de distintas formas da la misma cuenta', () => {
    for (const raw of ['@Ana.Perez', 'ana.perez', ' ana.perez ', 'https://www.instagram.com/ana.perez/', 'instagram.com/Ana.Perez?igsh=abc']) {
      expect(canonicalInstagram(raw), raw).toBe('ana.perez')
    }
  })

  it('rechaza lo que no es un usuario', () => {
    expect(canonicalInstagram('')).toBeNull()
    expect(canonicalInstagram('@')).toBeNull()
    expect(canonicalInstagram('con espacios')).toBeNull()
    expect(canonicalInstagram('x'.repeat(31))).toBeNull()
  })

  it('email interno y como se muestra en el panel', () => {
    expect(instagramEmail('ana.perez')).toBe('ana.perez@instagram.invalid')
    expect(instagramFromEventEmail('ana.perez@instagram.invalid')).toBe('ana.perez')
    expect(contactLabel('ana.perez@instagram.invalid')).toBe('Instagram @ana.perez')
    expect(isEventEmail('ana.perez@instagram.invalid')).toBe(true)
    expect(isEventEmail('5491155551234@whatsapp.invalid')).toBe(true)
    expect(isEventEmail('ana@x.com')).toBe(false)
  })
})

describe('email interno de las cuentas del QR', () => {
  it('ida y vuelta', () => {
    expect(eventEmail('5491155551234')).toBe('5491155551234@whatsapp.invalid')
    expect(phoneFromEventEmail('5491155551234@whatsapp.invalid')).toBe('5491155551234')
    expect(phoneFromEventEmail('ana@x.com')).toBeNull()
    expect(phoneFromEventEmail('x5491155551234@whatsapp.invalid')).toBeNull()
  })

  it('en el panel se muestra el WhatsApp', () => {
    expect(prettyPhone('5491155551234')).toBe('+54 9 11 5555-1234')
    expect(contactLabel('5491155551234@whatsapp.invalid')).toBe('WhatsApp +54 9 11 5555-1234')
    expect(contactLabel('ana@x.com')).toBe('ana@x.com')
  })
})

describe('enlace del QR', () => {
  it('la clave va en el fragmento y se lee de vuelta', () => {
    const url = eventJoinUrl('https://cecify.app/', 'AbCdEfGhIjKlMnOpQrStUvWx')
    expect(url).toBe('https://cecify.app/entrar#k=AbCdEfGhIjKlMnOpQrStUvWx')
    expect(parseEventHash(new URL(url).hash)).toBe('AbCdEfGhIjKlMnOpQrStUvWx')
  })

  it('ignora claves con basura o muy cortas', () => {
    expect(parseEventHash('')).toBeNull()
    expect(parseEventHash('#k=corta')).toBeNull()
    expect(parseEventHash('#k=<script>alert(1)</script>xxxxxxxx')).toBeNull()
  })
})
