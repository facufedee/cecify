import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { supabaseServer } from '@/lib/supabase'

const BUCKET = 'profile-photos'
const useLocal = process.env.LOCAL_DB === '1' && process.env.NODE_ENV !== 'production'

// Prefijo publico de las fotos de un usuario. Sirve para validar que una URL
// que llega en un perfil realmente salio de nuestro storage y es del propio usuario.
const publicPrefix = (userId: string) =>
  useLocal
    ? `/uploads/${userId}/`
    : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${userId}/`

export const isOwnPhotoUrl = (url: string, userId: string) =>
  url.startsWith(publicPrefix(userId)) && !url.includes('..')

// Guarda un JPEG ya procesado y devuelve su URL publica
export const savePhoto = async (userId: string, jpeg: Buffer) => {
  const file = `${randomBytes(12).toString('hex')}.jpg`

  if (useLocal) {
    const dir = path.join(process.cwd(), 'public', 'uploads', userId)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, file), jpeg)
    return `${publicPrefix(userId)}${file}`
  }

  const supabase = supabaseServer()
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}/${file}`, jpeg, { contentType: 'image/jpeg' })
  if (error) throw error
  return supabase.storage.from(BUCKET).getPublicUrl(`${userId}/${file}`).data.publicUrl
}
