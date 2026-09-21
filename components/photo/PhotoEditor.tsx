'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCw, X } from 'lucide-react'
import { useDialog } from '@/components/a11y/useDialog'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  cropRect,
  isLowRes,
  originalAspect,
  outputSize,
  panCenter,
  rotatedSize,
  type Center,
  type Size,
} from '@/lib/photo-crop'

// aspect: ancho / alto, o 'original' para conservar la proporcion de la foto
export type AspectChoice = { id: string; label: string; aspect: number | 'original' }

type Props = {
  file: File
  title: string
  aspects: AspectChoice[] // la primera es la que se elige al abrir
  minLongSide: number // por debajo de esto se avisa que puede verse borrosa
  onCancel: () => void
  onDone: (blob: Blob) => void
}

// Para no gastar la memoria del celular con fotos de 12 megapixeles: se trabaja con a lo sumo esto de lado mayor
// (lo que se sube igual se acota a MAX_UPLOAD)
const WORK_MAX_SIDE = 3200
const JPEG_QUALITY = 0.86
const KEY_STEP = 0.05 // fraccion del marco que se mueve con cada flecha
const ZOOM_STEP = 1.1

const fit = (box: Size, aspect: number): Size => {
  if (box.w <= 0 || box.h <= 0) return { w: 0, h: 0 }
  return box.w / box.h > aspect ? { w: box.h * aspect, h: box.h } : { w: box.w, h: box.w / aspect }
}

type Base = { img: CanvasImageSource; size: Size }

export default function PhotoEditor({ file, title, aspects, minLongSide, onCancel, onDone }: Props) {
  const dialogRef = useDialog<HTMLDivElement>(onCancel)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [base, setBase] = useState<Base | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [turns, setTurns] = useState(0)
  const [choiceId, setChoiceId] = useState(aspects[0].id)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [center, setCenter] = useState<Center | null>(null) // null = el centro de la foto
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Decodifica la foto respetando la orientacion EXIF (las del celular vienen "de costado" en el archivo)
  useEffect(() => {
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((b) => {
        if (cancelled) return b.close()
        bitmap = b
        const scale = Math.min(1, WORK_MAX_SIDE / Math.max(b.width, b.height))
        if (scale === 1) return setBase({ img: b, size: { w: b.width, h: b.height } })
        const c = document.createElement('canvas')
        c.width = Math.round(b.width * scale)
        c.height = Math.round(b.height * scale)
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error()
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(b, 0, 0, c.width, c.height)
        setBase({ img: c, size: { w: c.width, h: c.height } })
      })
      .catch(() => !cancelled && setLoadError('No se pudo abrir esa foto. Probá con otra.'))
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [file])

  // La foto ya girada (cada giro es de 90 grados)
  const source = useMemo<Base | null>(() => {
    if (!base) return null
    if (turns % 4 === 0) return base
    const size = rotatedSize(base.size, turns)
    const c = document.createElement('canvas')
    c.width = size.w
    c.height = size.h
    const ctx = c.getContext('2d')!
    ctx.translate(size.w / 2, size.h / 2)
    ctx.rotate((turns * Math.PI) / 2)
    ctx.drawImage(base.img, -base.size.w / 2, -base.size.h / 2)
    return { img: c, size }
  }, [base, turns])

  // Espacio disponible para el marco
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const choice = aspects.find((a) => a.id === choiceId) ?? aspects[0]
  const src = source?.size ?? { w: 1, h: 1 }
  const aspect = choice.aspect === 'original' ? originalAspect(src) : choice.aspect
  const frame = fit(box, aspect)
  const rect = cropRect(src, aspect, zoom, center ?? { x: src.w / 2, y: src.h / 2 })

  // Lo ultimo calculado, para los manejadores de gestos (que no se recrean en cada movimiento)
  const latest = useRef({ rect, frame })
  useEffect(() => {
    latest.current = { rect, frame }
  })

  // Dibuja el recorte en el marco
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source || frame.w <= 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(frame.w * dpr)
    canvas.height = Math.round(frame.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height)
  })

  const reset = () => {
    setZoom(MIN_ZOOM)
    setCenter(null)
  }
  const chooseAspect = (id: string) => {
    setChoiceId(id)
    reset()
  }
  const rotate = () => {
    setTurns((t) => (t + 1) % 4)
    reset()
  }
  const zoomTo = (z: number) => setZoom(clamp(z, MIN_ZOOM, MAX_ZOOM))
  const panBy = (dx: number, dy: number) => {
    const { rect: r, frame: f } = latest.current
    if (f.w > 0) setCenter(panCenter(r, f, dx, dy))
  }

  // Gestos: un dedo (o el mouse) mueve, dos dedos hacen zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const dist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinch.current = pointers.current.size === 2 ? { dist: dist() || 1, zoom } : null
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) zoomTo(pinch.current.zoom * (dist() / pinch.current.dist))
    else if (pointers.current.size === 1) panBy(e.clientX - prev.x, e.clientY - prev.y)
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    pinch.current = null
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const { frame: f } = latest.current
    const step = { x: f.w * KEY_STEP, y: f.h * KEY_STEP }
    const move: Record<string, [number, number]> = {
      ArrowLeft: [step.x, 0],
      ArrowRight: [-step.x, 0],
      ArrowUp: [0, step.y],
      ArrowDown: [0, -step.y],
    }
    if (move[e.key]) {
      e.preventDefault()
      panBy(...move[e.key])
    } else if (e.key === '+' || e.key === '=') zoomTo(zoom * ZOOM_STEP)
    else if (e.key === '-') zoomTo(zoom / ZOOM_STEP)
  }

  const finish = async () => {
    if (!source || saving) return
    setSaving(true)
    setError(null)
    try {
      const out = outputSize(rect)
      const canvas = document.createElement('canvas')
      canvas.width = out.w
      canvas.height = out.h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error()
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(source.img, rect.x, rect.y, rect.w, rect.h, 0, 0, out.w, out.h)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
      if (!blob) throw new Error()
      onDone(blob)
    } catch {
      setError('No se pudo procesar la foto, probá de nuevo')
      setSaving(false)
    }
  }

  const low = source ? isLowRes(rect, minLongSide) : false
  const chip = (on: boolean) =>
    `rounded-full border px-3.5 py-2 text-sm font-medium ${on ? 'border-white bg-white text-black' : 'border-white/60 text-white'}`

  return (
    <div className="focus-light fixed inset-0 z-[60] flex justify-center bg-black font-ig text-white">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex h-full w-full max-w-md flex-col outline-none"
      >
        <header className="flex items-center justify-between px-3 py-3">
          <button type="button" onClick={onCancel} aria-label="Cancelar" className="tap relative p-2">
            <X size={26} />
          </button>
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={finish}
            disabled={!source || saving}
            className="tap relative min-w-[4.5rem] p-2 text-right text-sm font-bold disabled:opacity-40"
          >
            {saving ? <Loader2 size={18} className="ml-auto animate-spin" /> : 'Listo'}
          </button>
        </header>

        <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center px-3">
          {loadError ? (
            <p role="alert" className="px-6 text-center text-sm">
              {loadError}
            </p>
          ) : !source ? (
            <Loader2 className="animate-spin" aria-label="Cargando la foto" />
          ) : (
            <div
              role="group"
              tabIndex={0}
              aria-label="Encuadre de la foto. Arrastrá para mover, o usá las flechas; con + y − hacés zoom."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP))}
              onKeyDown={onKeyDown}
              style={{ width: frame.w, height: frame.h, touchAction: 'none' }}
              className="cursor-grab overflow-hidden rounded-sm bg-neutral-900 active:cursor-grabbing"
            >
              <canvas ref={canvasRef} style={{ width: frame.w, height: frame.h }} className="block" />
            </div>
          )}
        </div>

        <div className="space-y-3 px-4 pb-5 pt-3">
          {source && (
            <p role="status" className={`text-center text-xs ${low ? 'font-semibold text-amber-300' : 'text-white/80'}`}>
              {low
                ? `Esta foto es chica (${Math.round(rect.w)}×${Math.round(rect.h)} px) y puede verse borrosa. Probá con otra o con menos zoom.`
                : `Foto de ${src.w}×${src.h} px`}
            </p>
          )}

          {aspects.length > 1 && (
            <div role="radiogroup" aria-label="Formato" className="flex flex-wrap justify-center gap-2">
              {aspects.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === choice.id}
                  onClick={() => chooseAspect(a.id)}
                  className={chip(a.id === choice.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2 text-sm">
              <span className="shrink-0">Zoom</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => zoomTo(Number(e.target.value))}
                className="h-8 w-full accent-white"
              />
            </label>
            <button type="button" onClick={rotate} className="flex items-center gap-1.5 rounded-full border border-white/60 px-3.5 py-2 text-sm font-medium">
              <RotateCw size={16} /> Girar
            </button>
          </div>

          {error && (
            <p role="alert" className="text-center text-sm">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
