// QR de la fiesta: reglas compartidas por cliente y servidor (sin dependencias).
// El QR abre /entrar#k=<clave>. Igual que las invitaciones, la clave va en el FRAGMENTO (#): el navegador no la
// manda al servidor, asi que no queda en logs ni en el "referrer".

// Dominios reservados (RFC 2606): nunca reciben correo. Identifican las cuentas creadas con el QR de la fiesta,
// segun con que dato entro la persona: <numero>@whatsapp.invalid o <usuario>@instagram.invalid
export const EVENT_EMAIL_DOMAIN = 'whatsapp.invalid'
export const INSTAGRAM_EMAIL_DOMAIN = 'instagram.invalid'

// Un mismo numero escrito de distintas formas tiene que dar la misma cuenta:
//   "11 5555-1234", "+54 11 5555 1234" y "+54 9 11 5555-1234" -> 5491155551234
// Numeros de otros paises (con su codigo) quedan como vienen. null = no parece un telefono.
export const canonicalPhone = (raw: string): string | null => {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2) // 0054... (formato internacional con 00)
  if (d.length === 10 && !d.startsWith('54')) d = `549${d}` // celular argentino sin codigo de pais
  else if (d.length === 12 && d.startsWith('54') && !d.startsWith('549')) d = `549${d.slice(2)}` // falto el 9
  return /^\d{8,15}$/.test(d) ? d : null
}

export const eventEmail = (phone: string) => `${phone}@${EVENT_EMAIL_DOMAIN}`

// El WhatsApp de una cuenta creada con el QR (null si entro por invitacion)
export const phoneFromEventEmail = (email: string | null | undefined) => {
  const m = email?.match(/^(\d{8,15})@whatsapp\.invalid$/)
  return m ? m[1] : null
}

// Usuario de Instagram sin @ y en minusculas (Instagram no distingue mayusculas). null = no es un usuario valido.
export const canonicalInstagram = (raw: string): string | null => {
  const handle = raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '') // pegaron el link del perfil
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .toLowerCase()
  return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null
}

export const instagramEmail = (handle: string) => `${handle}@${INSTAGRAM_EMAIL_DOMAIN}`

export const instagramFromEventEmail = (email: string | null | undefined) => {
  const m = email?.match(/^([a-z0-9._]{1,30})@instagram\.invalid$/)
  return m ? m[1] : null
}

// Cuenta creada con el QR de la fiesta (con cualquiera de los dos datos)
export const isEventEmail = (email: string) => phoneFromEventEmail(email) !== null || instagramFromEventEmail(email) !== null

// Para mostrar: 5491155551234 -> +54 9 11 5555-1234 (los argentinos); el resto con + adelante
export const prettyPhone = (phone: string) => {
  const ar = phone.match(/^549(11|\d{3,4})(\d+)$/)
  if (ar && phone.length === 13) {
    const rest = ar[2]
    return `+54 9 ${ar[1]} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
  }
  return `+${phone}`
}

// Como se muestra en el panel: el WhatsApp para quien entro con el QR, el email para el resto
export const contactLabel = (email: string) => {
  const phone = phoneFromEventEmail(email)
  if (phone) return `WhatsApp ${prettyPhone(phone)}`
  const ig = instagramFromEventEmail(email)
  return ig ? `Instagram @${ig}` : email
}

export const eventJoinUrl = (origin: string, key: string) => `${origin.replace(/\/+$/, '')}/entrar#k=${encodeURIComponent(key)}`

// La clave: letras, numeros, - y _ (base64url). null si no viene o trae basura.
export const parseEventHash = (hash: string) => {
  const key = new URLSearchParams(hash.replace(/^#/, '')).get('k')
  return key && /^[A-Za-z0-9_-]{16,100}$/.test(key) ? key : null
}
