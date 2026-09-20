import { describe, expect, it } from 'vitest'
import { CSV_MAX_ROWS, generateCode, isValidCode, normalizeCode, parseGuestsCsv, parseSide } from '@/lib/guests'
import { prettyCode } from '@/lib/format'

describe('codigos de acceso', () => {
  it('genera 8 caracteres sin los ambiguos (0, O, 1, I, L)', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode()
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
    }
    expect(new Set(Array.from({ length: 200 }, generateCode)).size).toBeGreaterThan(195)
  })

  it('normaliza y da formato', () => {
    expect(normalizeCode(' ab-cd 2345 ')).toBe('ABCD2345')
    expect(prettyCode('ABCD2345')).toBe('ABCD-2345')
    expect(isValidCode('ABCD2345')).toBe(true)
    expect(isValidCode('AB!')).toBe(false)
    expect(isValidCode('ABC')).toBe(false)
  })
})

describe('parseSide', () => {
  it('acepta espanol e ingles, vacio = sin lado y rechaza lo desconocido', () => {
    expect(parseSide('Novia')).toBe('bride')
    expect(parseSide(' novio ')).toBe('groom')
    expect(parseSide('ambos')).toBe('both')
    expect(parseSide('groom')).toBe('groom')
    expect(parseSide('')).toBeNull()
    expect(parseSide(undefined)).toBeNull()
    expect(parseSide('tio')).toBeUndefined()
  })
})

describe('parseGuestsCsv', () => {
  it('lee name,email,code,side y normaliza', () => {
    const r = parseGuestsCsv('name,email,code,side\nAna Pérez, ANA@X.com ,ab-cd2345,novia\nLuis,luis@x.com,,ambos\n')
    expect(r.errors).toEqual([])
    expect(r.hasSideColumn).toBe(true)
    expect(r.guests).toEqual([
      { name: 'Ana Pérez', email: 'ana@x.com', code: 'ABCD2345', side: 'bride' },
      { name: 'Luis', email: 'luis@x.com', code: null, side: 'both' },
    ])
  })

  it('sin columna side no toca el lado (undefined) y sin code deja el codigo en null', () => {
    const r = parseGuestsCsv('name,email\nAna,ana@x.com')
    expect(r.hasSideColumn).toBe(false)
    expect(r.guests[0]).toEqual({ name: 'Ana', email: 'ana@x.com', code: null, side: undefined })
  })

  it('acepta punto y coma (Excel), BOM, comillas, cabecera en espanol y saltos de linea de Windows', () => {
    const r = parseGuestsCsv('﻿nombre;correo;lado\r\n"Ana";"ana@x.com";novio\r\n')
    expect(r.errors).toEqual([])
    expect(r.guests).toEqual([{ name: 'Ana', email: 'ana@x.com', code: null, side: 'groom' }])
  })

  it('informa cada fila mala con su numero de linea y sigue con las demas', () => {
    const r = parseGuestsCsv(
      ['name,email,code,side', 'Ok,ok@x.com,,', ',sin@nombre.com,,', 'Mal,no-es-email,,', 'Dup,ok@x.com,,', 'Cod,cod@x.com,ab,', 'Lado,lado@x.com,,tio'].join('\n')
    )
    expect(r.guests.map((g) => g.email)).toEqual(['ok@x.com'])
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7])
    expect(r.errors[2].message).toMatch(/repetido/i)
    expect(r.errors[4].message).toMatch(/lado/i)
  })

  it('exige cabecera con name y email, archivo no vacio y un maximo de filas', () => {
    expect(parseGuestsCsv('').errors[0].message).toMatch(/vacío/i)
    expect(parseGuestsCsv('a,b\n1,2').errors[0].message).toMatch(/name y email/i)
    const many = 'name,email\n' + Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `G${i},g${i}@x.com`).join('\n')
    expect(parseGuestsCsv(many).errors[0].message).toMatch(/máximo/i)
  })
})
