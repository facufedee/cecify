// Captcha "no soy un robot" (Cloudflare Turnstile). Solo servidor.
// Se activa con TURNSTILE_SECRET_KEY (y NEXT_PUBLIC_TURNSTILE_SITE_KEY para el navegador). Sin la clave no se pide
// (desarrollo). Con la clave, si la verificacion falla o Cloudflare no responde, NO se deja pasar.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export const captchaEnabled = () => Boolean(process.env.TURNSTILE_SECRET_KEY)

export const verifyCaptcha = async (token: unknown, ip?: string): Promise<boolean> => {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (typeof token !== 'string' || !token || token.length > 2048) return false

  const body = new URLSearchParams({ secret, response: token })
  if (ip && ip !== 'unknown') body.set('remoteip', ip)
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch (error) {
    console.warn('[captcha] no se pudo verificar:', error instanceof Error ? error.message : error)
    return false
  }
}
