// Foto de una historia COMPLETA (sin recortar): entra entera en la pantalla vertical y el resto se rellena con
// la misma foto desenfocada, como hace Instagram. Una foto casi vertical (9:16) ocupa todo sin bordes.
// Tiene que estar dentro de un contenedor con position (relative o absolute).
export default function StoryImage({ src, alt }: { src: string; alt: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        loading="eager"
        decoding="async"
        className="absolute inset-0 h-full w-full scale-125 object-cover opacity-80 blur-2xl"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        loading="eager"
        decoding="async"
        className="absolute inset-0 h-full w-full object-contain"
      />
    </>
  )
}
