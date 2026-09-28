import { describe, expect, it } from 'vitest'
import { bioLikes, bioTeam, setBioTeam, startOtherTeam, toggleBioLike } from '@/lib/bio-picks'
import { ageProblem, cleanAgeInput } from '@/lib/profile-schema'

describe('gustos', () => {
  it('arma una sola frase con todos los gustos', () => {
    let bio = toggleBioLike('', 'bailar')
    expect(bio).toBe('Me gusta bailar')
    bio = toggleBioLike(bio, 'cocinar')
    expect(bio).toBe('Me gusta bailar y cocinar')
    bio = toggleBioLike(bio, 'lo dulce')
    expect(bio).toBe('Me gusta bailar, cocinar y lo dulce')
    expect(bioLikes(bio)).toEqual(['bailar', 'cocinar', 'lo dulce'])
  })

  it('tocar de nuevo lo saca; sin gustos desaparece la frase', () => {
    let bio = toggleBioLike(toggleBioLike('', 'bailar'), 'cocinar')
    bio = toggleBioLike(bio, 'bailar')
    expect(bio).toBe('Me gusta cocinar')
    expect(toggleBioLike(bio, 'cocinar')).toBe('')
  })

  it('respeta lo que la persona escribio a mano', () => {
    const bio = toggleBioLike('Amiga de la novia', 'el mate')
    expect(bio).toBe('Me gusta el mate · Amiga de la novia')
    expect(toggleBioLike(bio, 'el mate')).toBe('Amiga de la novia')
  })
})

describe('equipo', () => {
  it('uno solo: elegir otro lo reemplaza y elegir el mismo lo saca', () => {
    let bio = setBioTeam('Me gusta el fútbol', 'River')
    expect(bio).toBe('Me gusta el fútbol · Hincha de River')
    expect(bioTeam(bio)).toBe('River')
    bio = setBioTeam(bio, 'Racing')
    expect(bio).toBe('Me gusta el fútbol · Hincha de Racing')
    expect(setBioTeam(bio, 'Racing')).toBe('Me gusta el fútbol')
  })

  it('va despues de los gustos aunque se elija primero', () => {
    const bio = toggleBioLike(setBioTeam('', 'Boca'), 'bailar')
    expect(bio).toBe('Me gusta bailar · Hincha de Boca')
  })

  it('"otro equipo" deja "Hincha de " al final para escribirlo', () => {
    expect(startOtherTeam('')).toBe('Hincha de ')
    const bio = startOtherTeam('Me gusta bailar · Hincha de River')
    expect(bio).toBe('Me gusta bailar · Hincha de ')
    expect(bioTeam(`${bio}Huracán`)).toBe('Huracán')
  })
})

describe('edad', () => {
  it('solo digitos y como mucho dos (no se puede escribir 100 o mas)', () => {
    expect(cleanAgeInput('32')).toBe('32')
    expect(cleanAgeInput('150')).toBe('15')
    expect(cleanAgeInput('3a2')).toBe('32')
    expect(cleanAgeInput('-5')).toBe('5')
    expect(cleanAgeInput('2.5')).toBe('25')
  })

  it('explica que esta mal', () => {
    expect(ageProblem('')).toBeNull()
    expect(ageProblem('32')).toBeNull()
    expect(ageProblem('18')).toBeNull()
    expect(ageProblem('17')).toMatch(/al menos 18/)
    expect(ageProblem('5')).toMatch(/al menos 18/)
  })
})
