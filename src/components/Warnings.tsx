import type { Solution } from '../solver/types'

const STYLES: Record<string, string> = {
  error: 'border-red-500/40 bg-red-500/10 text-red-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  info: 'border-zinc-700/80 bg-zinc-900 text-zinc-400',
}

export function Warnings({ solution }: { solution: Solution }) {
  if (!solution.ok || solution.warnings.length === 0) return null
  return (
    <div className="mt-6 space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        Notes
      </h2>
      {solution.warnings.map((w, i) => (
        <div
          key={i}
          className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${STYLES[w.level]}`}
        >
          {w.text}
        </div>
      ))}
    </div>
  )
}
