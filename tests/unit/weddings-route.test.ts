import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/weddings/route'

const request = () =>
  new Request('http://localhost/api/weddings', {
    method: 'POST',
    body: JSON.stringify({ partnerA: 'Ana', partnerB: 'Beto', username: 'anabeto', password: 'clave-segura-123' }),
  })

describe('POST /api/weddings', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('sin WEDDING_SIGNUP_ENABLED no deja crear casamientos', async () => {
    vi.stubEnv('WEDDING_SIGNUP_ENABLED', '')
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'SIGNUP_DISABLED' })
  })
})
