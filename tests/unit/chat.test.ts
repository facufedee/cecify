import { describe, expect, it } from 'vitest'
import { isNearBottom, laterOf, mergeMessages, olderCursor, seenMessageId } from '@/lib/chat'

const msg = (id: string, from: string, at: string, pending = false) => ({ id, fromUserId: from, createdAt: at, pending })

describe('mergeMessages', () => {
  it('une sin repetir por id, ordena por fecha y prefiere lo nuevo', () => {
    const a = [msg('1', 'x', '2026-01-01T10:00:00.000Z'), msg('3', 'x', '2026-01-01T10:02:00.000Z')]
    const b = [msg('2', 'y', '2026-01-01T10:01:00.000Z'), { ...msg('3', 'x', '2026-01-01T10:02:00.000Z'), pending: true }]
    const r = mergeMessages(a, b)
    expect(r.map((m) => m.id)).toEqual(['1', '2', '3'])
    expect(r[2].pending).toBe(true)
  })
})

describe('olderCursor', () => {
  it('pide hasta 1 ms despues del mas viejo (para no perder los del mismo milisegundo)', () => {
    expect(olderCursor('2026-01-01T10:00:00.123Z')).toBe('2026-01-01T10:00:00.124Z')
    expect(olderCursor('2026-01-01T10:00:00.999Z')).toBe('2026-01-01T10:00:01.000Z')
  })
})

describe('seenMessageId', () => {
  const me = 'me'
  const list = [
    msg('a', me, '2026-01-01T10:00:00.000Z'),
    msg('b', 'other', '2026-01-01T10:01:00.000Z'),
    msg('c', me, '2026-01-01T10:02:00.000Z'),
    msg('d', me, '2026-01-01T10:03:00.000Z'),
  ]

  it('devuelve el ultimo mensaje propio leido y solo ese', () => {
    expect(seenMessageId(list, me, '2026-01-01T10:02:00.000Z')).toBe('c')
    expect(seenMessageId(list, me, '2026-01-01T10:03:00.000Z')).toBe('d')
    expect(seenMessageId(list, me, '2026-01-01T10:00:30.000Z')).toBe('a')
  })

  it('sin lectura, o con lectura anterior a todo, no hay "Visto"', () => {
    expect(seenMessageId(list, me, null)).toBeNull()
    expect(seenMessageId(list, me, '2025-12-31T00:00:00.000Z')).toBeNull()
  })

  it('ignora mensajes de la otra persona y los que todavia se estan enviando', () => {
    expect(seenMessageId([msg('b', 'other', '2026-01-01T10:01:00.000Z')], me, '2026-01-01T11:00:00.000Z')).toBeNull()
    const withPending = [...list, msg('tmp', me, '2026-01-01T10:04:00.000Z', true)]
    expect(seenMessageId(withPending, me, '2026-01-01T12:00:00.000Z')).toBe('d')
  })

  it('tolera 1 ms de diferencia de precision con el servidor', () => {
    expect(seenMessageId([msg('a', me, '2026-01-01T10:00:00.124Z')], me, '2026-01-01T10:00:00.123Z')).toBe('a')
    expect(seenMessageId([msg('a', me, '2026-01-01T10:00:00.126Z')], me, '2026-01-01T10:00:00.123Z')).toBeNull()
  })
})

describe('laterOf e isNearBottom', () => {
  it('la lectura solo avanza', () => {
    expect(laterOf(null, null)).toBeNull()
    expect(laterOf(null, '2026-01-01T10:00:00.000Z')).toBe('2026-01-01T10:00:00.000Z')
    expect(laterOf('2026-01-01T10:05:00.000Z', '2026-01-01T10:00:00.000Z')).toBe('2026-01-01T10:05:00.000Z')
    expect(laterOf('2026-01-01T10:00:00.000Z', null)).toBe('2026-01-01T10:00:00.000Z')
  })

  it('detecta si se esta leyendo el final', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(true) // faltan 100
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(false) // faltan 300
    expect(isNearBottom({ scrollHeight: 300, scrollTop: 0, clientHeight: 400 })).toBe(true) // todo entra
  })
})
