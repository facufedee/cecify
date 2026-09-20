import { describe, expect, it } from 'vitest'
import { inviteMailto, inviteUrl, parseInviteHash } from '@/lib/invite'

const hashOf = (url: string) => new URL(url).hash

describe('inviteUrl / parseInviteHash', () => {
  it('arma el enlace con email y codigo en el fragmento, no en la consulta', () => {
    const url = inviteUrl('https://cecify.app/', 'ana@ejemplo.com', 'abcd-2345')
    expect(url).toBe('https://cecify.app/login#e=ana@ejemplo.com&c=abcd2345')
    expect(new URL(url).search).toBe('') // nada viaja al servidor
  })

  it('ida y vuelta, incluso con caracteres especiales en el email', () => {
    for (const email of ['ana@ejemplo.com', 'a+b@ejemplo.com', 'o.brien&co@ejemplo.com', 'a#b@ejemplo.com', 'ñandú@ejemplo.com']) {
      const url = inviteUrl('http://localhost:3000', email, 'ABCD2345')
      expect(parseInviteHash(hashOf(url))).toEqual({ email, code: 'ABCD2345' })
    }
  })

  it('normaliza mayusculas, espacios y guiones al leer', () => {
    expect(parseInviteHash('#e= ANA@Ejemplo.com &c=ab-cd 2345')).toEqual({ email: 'ana@ejemplo.com', code: 'ABCD2345' })
    expect(parseInviteHash('e=ana@ejemplo.com&c=ABCD2345')).toEqual({ email: 'ana@ejemplo.com', code: 'ABCD2345' }) // sin #
  })

  it('rechaza lo incompleto o con basura', () => {
    expect(parseInviteHash('')).toBeNull()
    expect(parseInviteHash('#e=ana@ejemplo.com')).toBeNull()
    expect(parseInviteHash('#c=ABCD2345')).toBeNull()
    expect(parseInviteHash('#e=no-es-email&c=ABCD2345')).toBeNull()
    expect(parseInviteHash('#e=ana@ejemplo.com&c=ab')).toBeNull()
    expect(parseInviteHash('#e=ana@ejemplo.com&c=<script>')).toBeNull()
    expect(parseInviteHash(`#e=${'a'.repeat(250)}@x.com&c=ABCD2345`)).toBeNull()
  })
})

describe('inviteMailto', () => {
  it('lleva el enlace y el codigo con formato, y escapa el asunto y el cuerpo', () => {
    const url = inviteUrl('https://cecify.app', 'ana@ejemplo.com', 'ABCD2345')
    const mail = inviteMailto({ name: 'Ana & Luis', email: 'ana@ejemplo.com', code: 'ABCD2345' }, url)
    expect(mail.startsWith('mailto:ana@ejemplo.com?subject=')).toBe(true)
    const body = new URLSearchParams(mail.split('?')[1]).get('body')!
    expect(body).toContain('Hola Ana & Luis!')
    expect(body).toContain(url)
    expect(body).toContain('ABCD-2345')
  })
})
