import { describe, expect, it } from 'vitest'
import { dummyHash, hashPassword, verifyPassword } from '@/lib/password'
import { passwordProblem, USERNAME_RE } from '@/lib/password-rules'

describe('contraseñas', () => {
  it('se guarda un hash (nunca el texto) y se verifica', async () => {
    const hash = await hashPassword('una frase bastante larga')
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/)
    expect(hash).not.toContain('una frase')
    expect(await verifyPassword('una frase bastante larga', hash)).toBe(true)
    expect(await verifyPassword('otra cosa', hash)).toBe(false)
  })

  it('la misma contraseña da hashes distintos (sal aleatoria)', async () => {
    expect(await hashPassword('igualigual')).not.toBe(await hashPassword('igualigual'))
  })

  it('rechaza hashes con otro formato', async () => {
    expect(await verifyPassword('x', 'md5$abc')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })

  it('el hash de relleno no coincide con nada razonable', async () => {
    expect(await verifyPassword('', await dummyHash())).toBe(false)
  })

  it('reglas', () => {
    expect(passwordProblem('corta')).toMatch(/al menos 8/)
    expect(passwordProblem('suficiente')).toBeNull()
    expect(passwordProblem('x'.repeat(201))).toMatch(/larga/)
    expect(USERNAME_RE.test('facu.fede_1')).toBe(true)
    expect(USERNAME_RE.test('Facu')).toBe(false) // se guarda en minusculas
    expect(USERNAME_RE.test('ab')).toBe(false)
  })
})
