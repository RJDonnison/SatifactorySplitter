import { useMemo, useState } from 'react'
import { F, formatFrac, frac } from '../solver/frac'
import { speedOf } from '../solver/gameData'
import type { Solution } from '../solver/types'
import { BELT_HEX, BELT_LABELS } from '../diagram/belts'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-zinc-400">{label}</span>
      <span className="font-medium tabular-nums text-zinc-200">{value}</span>
    </div>
  )
}

export function Summary({ solution }: { solution: Solution }) {
  const stats = useMemo(() => {
    const belts = new Map<number, number>()
    let anyBelts = 0
    let taps = 0
    for (const e of solution.edges) {
      if (e.tapMk !== null) {
        belts.set(e.tapMk, (belts.get(e.tapMk) ?? 0) + 1)
        taps++
      } else if (e.minMk !== null && e.minMk > 1) {
        belts.set(e.minMk, (belts.get(e.minMk) ?? 0) + 1)
      } else {
        anyBelts++
      }
    }
    const overflowNode = solution.nodes.find((n) => n.kind === 'overflow')
    return {
      belts,
      anyBelts,
      taps,
      overflowRate:
        overflowNode && overflowNode.kind === 'overflow'
          ? overflowNode.rate
          : null,
    }
  }, [solution])

  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* clipboard unavailable — URL is already in the address bar */
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (!solution.ok) {
    return (
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Build summary
        </h2>
        <p className="text-sm text-zinc-500">
          Fix the input problem to see a build summary.
        </p>
      </section>
    )
  }

  const sinkRates = solution.nodes
    .filter((n) => n.kind === 'sink')
    .map((n) => (n.kind === 'sink' ? n : null))
    .filter((n): n is NonNullable<typeof n> => n !== null)

  return (
    <section className="space-y-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Build summary
      </h2>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">
          Buildings
        </h3>
        <Row
          label="Conveyor splitters"
          value={String(solution.buildings.splitters)}
        />
        <Row
          label="Conveyor mergers"
          value={String(solution.buildings.mergers)}
        />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">
          Belts (min tier per segment)
        </h3>
        {[...stats.belts.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([mk, count]) => (
            <div key={mk} className="flex items-center gap-2 py-0.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: BELT_HEX[mk - 1] }}
              />
              <span className="flex-1 text-zinc-400">
                {BELT_LABELS[mk - 1]}
                <span className="text-zinc-600"> · {speedOf(mk)}/min</span>
              </span>
              <span className="font-medium tabular-nums text-zinc-200">
                ×{count}
              </span>
            </div>
          ))}
        {stats.anyBelts > 0 && (
          <div className="flex items-center gap-2 py-0.5">
            <span className="h-2 w-2 rounded-full bg-zinc-500" />
            <span className="flex-1 text-zinc-400">
              Any belt<span className="text-zinc-600"> · ≤60/min</span>
            </span>
            <span className="font-medium tabular-nums text-zinc-200">
              ×{stats.anyBelts}
            </span>
          </div>
        )}
        {stats.taps > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            incl. {stats.taps} saturation tap{stats.taps > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">
          Outputs
        </h3>
        {sinkRates.map((sink, i) => (
          <Row
            key={sink.id}
            label={`Output ${i + 1}${sink.approximate ? ' · approx' : ''}`}
            value={`${formatFrac(sink.rate)}/min`}
          />
        ))}
        {stats.overflowRate && (
          <Row
            label="Overflow"
            value={`${formatFrac(stats.overflowRate)}/min`}
          />
        )}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">
          Total input
        </h3>
        <Row
          label="Items / min"
          value={`${formatFrac(solution.inputRate)}/min`}
        />
        <Row
          label="Distributed"
          value={`${formatFrac(
            sinkRates.reduce((acc, s) => F.add(acc, s.rate), frac(0)),
          )}/min`}
        />
      </div>

      <button
        type="button"
        onClick={share}
        className="w-full rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
      >
        {copied ? 'Link copied' : 'Copy share link'}
      </button>
    </section>
  )
}
