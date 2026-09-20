// Enlace de invitacion: abre la app y entra solo con el email y el codigo del invitado.
// Van en el FRAGMENTO (#), no en la consulta (?): el navegador no lo manda nunca al servidor, asi que
// no queda en logs, proxies ni en el "referrer". La pagina de login lo lee y lo borra de la barra.
// Sin dependencias: lo usan cliente y servidor.

const clean = (s: string) => s.replace(/\/+$/, '')

// http://host/login#e=ana@ejemplo.com&c=ABCD2345
export const inviteUrl = (origin: string, email: string, code: string) =>
  `${clean(origin)}/login#e=${encodeURIComponent(email).replace(/%40/g, '@')}&c=${encodeURIComponent(code.replace(/[\s-]/g, ''))}`

// null si el fragmento no trae los dos datos o vienen con basura
export const parseInviteHash = (hash: string): { email: string; code: string } | null => {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const email = params.get('e')?.trim().toLowerCase()
  const code = params.get('c')?.replace(/[\s-]/g, '').toUpperCase()
  if (!email || !code) return null
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  if (!/^[A-Z0-9]{4,50}$/.test(code)) return null
  return { email, code }
}

// Correo listo para enviar (mailto:) con el enlace y el codigo por si el enlace no abre
export const inviteMailto = (guest: { name: string; email: string; code: string }, url: string) => {
  const pretty = `${guest.code.slice(0, 4)}-${guest.code.slice(4)}`
  const subject = 'Tu acceso a Cecify, la app de la fiesta de Lucas y Cecilia'
  const body = [
    `Hola ${guest.name}!`,
    '',
    'Entrá a Cecify desde este enlace (te deja adentro directamente):',
    url,
    '',
    `Si el enlace no abre, entrá a la app con tu email (${guest.email}) y este código: ${pretty}`,
  ].join('\n')
  return `mailto:${encodeURIComponent(guest.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
