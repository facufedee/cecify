// Genera los iconos de la PWA, el favicon y la marca del login a partir de la hoja de logos.
// Uso: node scripts/generate-icons.mjs ["ruta/a/la-hoja.png"]
//
// Toma el monograma "CL" verde sobre beige de la hoja (celda "monocromo verde"), lo convierte en
// una mascara (mas oscuro = mas opaco) y lo compone en crema sobre el verde de marca.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const SRC = process.argv[2] ?? 'ChatGPT Image 20 sept 2026, 11_49_36.png'
const OUT = 'public/icons'
const BRAND = { r: 0x4a, g: 0x7c, b: 0x59 } // mismo verde que theme_color
const CREAM = { r: 0xf1, g: 0xee, b: 0xe5 }

// Region del monograma dentro de la hoja (sin el texto de la celda)
const GLYPH = { left: 316 + 40, top: 452 + 56, width: 240, height: 250 }
const BG_LUMA = 236 // beige de fondo
const INK_LUMA = 100 // verde del trazo

mkdirSync(OUT, { recursive: true })

const { data, info } = await sharp(SRC)
  .extract(GLYPH)
  .flatten({ background: '#f1eee5' })
  .raw()
  .toBuffer({ resolveWithObject: true })

// Mascara: alfa segun cuan oscuro es cada pixel
const alpha = Buffer.alloc(info.width * info.height)
let minX = info.width
let maxX = 0
let minY = info.height
let maxY = 0
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels
    const luma = (data[i] + data[i + 1] + data[i + 2]) / 3
    const a = Math.max(0, Math.min(1, (BG_LUMA - luma) / (BG_LUMA - INK_LUMA)))
    const v = Math.round(a * 255)
    alpha[y * info.width + x] = v
    if (v > 40) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
}
const crop = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
console.log(`Monograma detectado: ${crop.width}x${crop.height}px`)

// Glifo de un color, con la mascara como canal alfa, recortado justo al trazo
const glyph = (color, height) =>
  sharp(
    Buffer.concat([
      ...Array.from({ length: info.width * info.height }, (_, p) =>
        Buffer.from([color.r, color.g, color.b, alpha[p]])
      ),
    ]),
    { raw: { width: info.width, height: info.height, channels: 4 } }
  )
    .extract(crop)
    .resize({ height: Math.round(height), kernel: 'lanczos3' })
    .png()
    .toBuffer()

const square = (size, radiusPct) => {
  const r = Math.round(size * radiusPct)
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="rgb(${BRAND.r},${BRAND.g},${BRAND.b})"/></svg>`
  )
}

// glyphRatio: alto del monograma respecto al icono. Los maskable necesitan margen (zona segura).
const icon = async (size, { radius = 0, glyphRatio = 0.6 } = {}) => {
  const g = await glyph(CREAM, size * glyphRatio)
  return sharp(square(size, radius))
    .composite([{ input: g, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

const files = {
  'icon-192.png': await icon(192, { radius: 0.22, glyphRatio: 0.62 }),
  'icon-512.png': await icon(512, { radius: 0.22, glyphRatio: 0.62 }),
  'icon-maskable-192.png': await icon(192, { glyphRatio: 0.5 }),
  'icon-maskable-512.png': await icon(512, { glyphRatio: 0.5 }),
  'apple-touch-icon.png': await icon(180, { glyphRatio: 0.6 }),
  'favicon-32.png': await icon(32, { radius: 0.2, glyphRatio: 0.66 }),
  'favicon-16.png': await icon(16, { radius: 0.2, glyphRatio: 0.7 }),
  // Marca verde sobre fondo transparente para el login
  'logo-mark.png': await glyph(BRAND, 240),
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

console.log(`Generados ${Object.keys(files).length + 1} archivos en ${OUT}/`)
