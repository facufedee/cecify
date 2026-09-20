'use client'

import { useParams } from 'next/navigation'
import ProfileView from '@/components/wall/ProfileView'

export default function GuestProfilePage() {
  const { id } = useParams<{ id: string }>()
  return <ProfileView userId={id} />
}
