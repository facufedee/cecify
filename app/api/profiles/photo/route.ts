import sharp from 'sharp'
import { getAuth, unauthorized } from '@/lib/api-auth'
import { rateLimit } from '@/lib/rate-limit'
import { savePhoto } from '@/lib/storage'

// El cliente ya comprime antes de subir (Vercel limita el body a ~4.5MB)
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(req: Request) {
  const auth = getAuth(req)
  if (!auth) return unauthorized()

  const limit = rateLimit(`photo:${auth.userId}`, 20, 10 * 60_000)
  if (!limit.ok) {
    return Response.json(
      { error: 'Demasiadas subidas, probá de nuevo en unos minutos' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
    )
  }

  let file: FormDataEntryValue | null
  try {
    file = (await req.formData()).get('file')
  } catch {
    return Response.json({ error: 'Archivo inválido' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return Response.json({ error: 'Falta el archivo' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'La foto es demasiado pesada' }, { status: 413 })
  }

  try {
    // sharp decodifica de verdad: si no es una imagen real, falla (no confiamos en el mimetype)
    const jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate() // respeta la orientacion EXIF; el re-encode elimina el EXIF (incluido GPS)
      .resize({ width: 1080, height: 1440, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    const url = await savePhoto(auth.userId, jpeg)
    return Response.json({ url })
  } catch (error) {
    if (error instanceof Error && /unsupported image format|Input buffer/i.test(error.message)) {
      return Response.json({ error: 'El archivo no es una imagen válida' }, { status: 400 })
    }
    console.error('profiles/photo error:', error)
    return Response.json({ error: 'Error del servidor' }, { status: 500 })
  }
}
