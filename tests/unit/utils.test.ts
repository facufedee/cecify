import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatShortAgo } from '@/lib/format'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it('deja pasar hasta el maximo y despues bloquea con Retry-After', () => {
    const key = 'test:a'
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true)
    const blocked = rateLimit(key, 3, 60_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
    expect(blocked.retryAfter).toBeLessThanOrEqual(60)
  })

  it('se reinicia al terminar la ventana y las claves son independientes', () => {
    const key = 'test:b'
    for (let i = 0; i < 4; i++) rateLimit(key, 3, 60_000)
    expect(rateLimit('test:otra', 3, 60_000).ok).toBe(true)
    vi.advanceTimersByTime(60_001)
    expect(rateLimit(key, 3, 60_000).ok).toBe(true)
  })

  it('toma la IP del primer valor de x-forwarded-for', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })
    expect(getClientIp(req)).toBe('1.2.3.4')
    expect(getClientIp(new Request('http://x'))).toBe('unknown')
  })
})

describe('formatShortAgo', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('usa el formato corto de Instagram', () => {
    expect(formatShortAgo(ago(10_000))).toBe('ahora')
    expect(formatShortAgo(ago(47 * 60_000))).toBe('47 min')
    expect(formatShortAgo(ago(3 * 3_600_000))).toBe('3 h')
    expect(formatShortAgo(ago(2 * 86_400_000))).toBe('2 d')
  })

  it('pasada una semana muestra la fecha', () => {
    expect(formatShortAgo(ago(9 * 86_400_000))).toMatch(/\d/)
    expect(formatShortAgo(ago(9 * 86_400_000))).not.toMatch(/ d$/)
  })
})
