import { Camera, Loader2, Plus, X } from 'lucide-react'

type Props = {
  preview: string | null
  uploading: boolean
  main?: boolean
  onFile: (file: File) => void
  onRemove?: () => void // solo fotos extra que ya tienen imagen
}

export default function PhotoSlot({ preview, uploading, main = false, onFile, onRemove }: Props) {
  const label = main ? (preview ? 'Cambiar foto' : 'Agregar foto principal') : 'Agregar foto'

  return (
    <label
      className={`group relative flex cursor-pointer items-center justify-center overflow-hidden bg-cream ring-1 ring-cream-dark transition hover:ring-brand ${
        main ? 'h-56 w-56 rounded-[2rem]' : 'h-24 w-24 rounded-2xl'
      }`}
    >
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {uploading ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          <Loader2 className="animate-spin" size={main ? 32 : 22} />
        </span>
      ) : preview ? (
        main && (
          <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-1.5 rounded-xl bg-black/45 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
            <Camera size={14} /> {label}
          </span>
        )
      ) : (
        <span className="flex flex-col items-center gap-1 text-brand-dark">
          {main ? <Camera size={32} /> : <Plus size={24} />}
          <span className="px-2 text-center text-xs font-medium">{label}</span>
        </span>
      )}

      {onRemove && preview && !uploading && (
        <button
          type="button"
          aria-label="Quitar foto"
          onClick={(e) => {
            e.preventDefault() // no abrir el selector de archivos
            e.stopPropagation()
            onRemove()
          }}
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
        >
          <X size={14} />
        </button>
      )}

      <input
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </label>
  )
}
