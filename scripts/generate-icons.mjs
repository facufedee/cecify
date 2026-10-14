// Genera los iconos de la PWA, el favicon y la marca chica de la app a partir del logo fuente.
// Uso: node scripts/generate-icons.mjs ["ruta/al-logo.png"]
//
// La fuente es assets/logo-source.png (corazon verde con la "L", fondo transparente, 512x512).
// Nunca se lee desde public/icons: esos archivos son la salida y se pisan en cada corrida.
// Los iconos de app van sobre crema (#F5EFE0); los maskable dejan 20% de margen por la zona segura.
import sharp from 'sharp'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2] ?? 'assets/logo-source.png'
const OUT = 'public/icons'
const CREAM = { r: 0xf5, g: 0xef, b: 0xe0, alpha: 1 }
// Paleta indexada: los PNG pesan una fraccion y el logo (pocos colores) no pierde calidad visible
const PNG = { compressionLevel: 9, palette: true }

// Logo centrado sobre un cuadrado crema, con padding = proporcion del lado en cada borde
const onCream = async (size, padding) => {
  const pad = Math.round(size * padding)
  const inner = await sharp(SRC)
    .resize(size - pad * 2, size - pad * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
    .composite([{ input: inner, top: pad, left: pad }])
    .png(PNG)
    .toBuffer()
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  const files = {
    'icon-192.png': await onCream(192, 0.12),
    'icon-512.png': await onCream(512, 0.12),
    'icon-maskable-192.png': await onCream(192, 0.2),
    'icon-maskable-512.png': await onCream(512, 0.2),
    'apple-touch-icon.png': await onCream(180, 0.12),
    // Con fondo crema se leen en la pestaña aunque el navegador use tema oscuro
    'favicon-32.png': await onCream(32, 0.06),
    'favicon-16.png': await onCream(16, 0.04),
    // Marca chica con fondo transparente para los encabezados (se muestra a 20-36px)
    'logo-mark.png': await sharp(SRC).resize({ width: 160 }).png(PNG).toBuffer(),
  }
  for (const [name, buf] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, buf)

  // favicon.ico con dos PNG adentro (16 y 32): los navegadores modernos lo aceptan
  const pngs = [files['favicon-16.png'], files['favicon-32.png']]
  const sizes = [16, 32]
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // tipo: icono
  header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map((png, i) => {
    const e = Buffer.alloc(16)
    e[0] = sizes[i]
    e[1] = sizes[i]
    e.writeUInt16LE(1, 4) // planos
    e.writeUInt16LE(32, 6) // bits por pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([header, ...entries, ...pngs]))

  for (const name of [...Object.keys(files), 'favicon.ico']) {
    console.log(`${name.padEnd(24)} ${statSync(`${OUT}/${name}`).size} bytes`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
