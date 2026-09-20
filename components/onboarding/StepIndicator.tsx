import { Check } from 'lucide-react'

export default function StepIndicator({ current, total = 3 }: { current: number; total?: number }) {
  return (
    <ol className="flex items-center justify-center" aria-label={`Paso ${current} de ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <li key={n} className="flex items-center">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                done
                  ? 'border-brand bg-brand text-white'
                  : active
                    ? 'border-brand bg-brand text-white'
                    : 'border-neutral-300 bg-white text-neutral-400'
              }`}
            >
              {done ? <Check size={16} strokeWidth={3} /> : `0${n}`}
            </span>
            {n < total && (
              <span
                className={`mx-1 w-12 border-t-2 border-dashed ${
                  done ? 'border-brand' : 'border-neutral-300'
                }`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
