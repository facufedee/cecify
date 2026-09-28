import { redirect } from 'next/navigation'

// Direccion vieja del QR de la fiesta (carteles ya impresos): ahora todos entran por /login
export default function EventJoinPage() {
  redirect('/login')
}
