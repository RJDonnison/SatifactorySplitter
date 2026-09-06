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
    const tapBelts = new Map<number, number>()
    let anyBelts = 0
    for (const e of solution.edges) {
      if (e.tapMk !== null) {
        tapBelts.set(e.tapMk, (tapBelts.get(e.tapMk) ?? 0) + 1)
      } else {
        // only saturation taps need a specific tier; every other segment
        // runs on any belt you have lying around
        anyBelts++
      }
    }
    const overflowNode = solution.nodes.find((n) => n.kind === 'overflow')
    return {
      tapBelts,
      anyBelts,
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
          Belts
        </h3>
        {[...stats.tapBelts.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([mk, count]) => (
            <div key={mk} className="flex items-center gap-2 py-0.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: BELT_HEX[mk - 1] }}
              />
              <span className="flex-1 text-zinc-400">
                {BELT_LABELS[mk - 1]} tap
                <span className="text-zinc-600"> · {speedOf(mk)}/min</span>
              </span>
              <span className="font-medium tabular-nums text-zinc-200">
                ×{count}
              </span>
            </div>
          ))}
        <div className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-full bg-zinc-500" />
          <span className="flex-1 text-zinc-400">Any belt</span>
          <span className="font-medium tabular-nums text-zinc-200">
            ×{stats.anyBelts}
          </span>
        </div>
        {stats.tapBelts.size > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            Only saturation taps need their exact tier.
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
