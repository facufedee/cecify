import { useState } from 'react'

// Avatar con el anillo de gradiente tipico de las historias. Sin `ring`, queda un borde fino.
export default function StoryRing({
  src,
  size = 64,
  ring = true,
  seen = false,
  alt = '',
}: {
  src: string
  size?: number
  ring?: boolean
  seen?: boolean // ya vista: el anillo pasa a gris
  alt?: string
}) {
  const [error, setError] = useState(false)

  // Sin foto (todavia cargando, sin perfil o con error) queda un circulo neutro: nunca un <img src=""> roto
  const image = src && !error ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      decoding="async"
      onError={() => setError(true)}
      className="h-full w-full rounded-full border-2 border-white bg-ig-soft object-cover"
    />
  ) : (
    <span className="block h-full w-full rounded-full border-2 border-white bg-ig-soft" />
  )

  if (!ring) {
    return (
      <span className="block shrink-0 rounded-full border border-ig-border p-[1px]" style={{ width: size, height: size }}>
        {image}
      </span>
    )
  }

  return (
    <span
      className="block shrink-0 rounded-full p-[2.5px]"
      style={{
        width: size,
        height: size,
        background: seen
          ? '#c7c7c7'
          : 'linear-gradient(45deg, #feda75, #fa7e1e, #d62976, #962fbf, #4f5bd5)',
      }}
    >
      {image}
    </span>
  )
}
