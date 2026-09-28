// Emails internos de algunas cuentas y como se muestran en el panel. Sin dependencias.
//   <numero>@whatsapp.invalid y <usuario>@instagram.invalid: entraron con el QR de la fiesta (forma vieja, ya no se usa)
//   g-<id>@lista.invalid: se registraron desde la lista sin tener email
// Son dominios reservados (RFC 2606): nunca reciben correo.

// El WhatsApp de una cuenta creada con el QR (null si no)
export const phoneFromEventEmail = (email: string | null | undefined) => {
  const m = email?.match(/^(\d{8,15})@whatsapp\.invalid$/)
  return m ? m[1] : null
}

export const instagramFromEventEmail = (email: string | null | undefined) => {
  const m = email?.match(/^([a-z0-9._]{1,30})@instagram\.invalid$/)
  return m ? m[1] : null
}

// Email de verdad (se le puede escribir): no los internos ni la falta de email
export const hasRealEmail = (email: string | null | undefined): email is string => Boolean(email) && !email!.endsWith('.invalid')

// Para mostrar: 5491155551234 -> +54 9 11 5555-1234 (los argentinos); el resto con + adelante
export const prettyPhone = (phone: string) => {
  const ar = phone.match(/^549(11|\d{3,4})(\d+)$/)
  if (ar && phone.length === 13) {
    const rest = ar[2]
    return `+54 9 ${ar[1]} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
  }
  return `+${phone}`
}

// Como se muestra en el panel
export const contactLabel = (email: string | null) => {
  const phone = phoneFromEventEmail(email)
  if (phone) return `WhatsApp ${prettyPhone(phone)}`
  const ig = instagramFromEventEmail(email)
  if (ig) return `Instagram @${ig}`
  return hasRealEmail(email) ? email : 'Sin email (de la lista)'
}
