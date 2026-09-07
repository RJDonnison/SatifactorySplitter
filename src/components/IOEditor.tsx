import { BELT_SPEEDS } from '../solver/gameData'
import { BELT_HEX, BELT_LABELS } from '../diagram/belts'
import { useStore } from '../state/store'

function RateInput({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      min={0}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm font-medium tabular-nums text-zinc-100 focus:border-amber-400/60 focus:outline-none"
    />
  )
}

function BeltPips({
  rate,
  onPick,
}: {
  rate: number
  onPick: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {BELT_SPEEDS.map((s, i) => (
        <button
          key={s}
          type="button"
          title={`${BELT_LABELS[i]} — ${s}/min`}
          aria-label={`Set ${BELT_LABELS[i]} (${s} per minute)`}
          onClick={() => onPick(s)}
          className="h-3.5 w-3.5 rounded-full border transition-transform hover:scale-125"
          style={{
            backgroundColor: BELT_HEX[i],
            borderColor: rate === s ? '#fafafa' : 'transparent',
            boxShadow: rate === s ? `0 0 0 1px ${BELT_HEX[i]}` : undefined,
          }}
        />
      ))}
    </div>
  )
}

function Section({
  title,
  total,
  hint,
  onAdd,
  addLabel,
  children,
}: {
  title: string
  total: number
  hint?: string
  onAdd: () => void
  addLabel: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          {title}
        </h2>
        <span className="text-xs tabular-nums text-zinc-500">{total}/min</span>
      </div>
      <div className="space-y-2">{children}</div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 w-full rounded-lg border border-dashed border-zinc-800 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300"
      >
        {addLabel}
      </button>
      {hint && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-400/80">
          {hint}
        </p>
      )}
    </section>
  )
}

export function IOEditor() {
  const inputs = useStore((s) => s.inputs)
  const outputs = useStore((s) => s.outputs)
  const tolerance = useStore((s) => s.tolerance)
  const maxMk = useStore((s) => s.maxMk)
  const addInput = useStore((s) => s.addInput)
  const removeInput = useStore((s) => s.removeInput)
  const setInput = useStore((s) => s.setInput)
  const addOutput = useStore((s) => s.addOutput)
  const removeOutput = useStore((s) => s.removeOutput)
  const setOutput = useStore((s) => s.setOutput)
  const setTolerance = useStore((s) => s.setTolerance)
  const setMaxMk = useStore((s) => s.setMaxMk)

  const totalIn = inputs.reduce((a, b) => a + b.rate, 0)
  const totalOut = outputs.reduce((a, b) => a + b.rate, 0)
  const over = totalOut > totalIn

  return (
    <div className="space-y-6">
      <Section
        title="Inputs"
        total={totalIn}
        onAdd={addInput}
        addLabel="+ Add input belt"
      >
        {inputs.map((belt, i) => (
          <div key={belt.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-4 text-right text-xs tabular-nums text-zinc-600">
                {i + 1}
              </span>
              <RateInput
                value={belt.rate}
                onChange={(rate) => setInput(belt.id, { rate })}
              />
              <span className="text-xs text-zinc-500">/min</span>
              <button
                type="button"
                aria-label="Remove input"
                onClick={() => removeInput(belt.id)}
                className="ml-auto rounded-md px-1 text-zinc-600 transition-colors hover:text-red-400"
              >
                ×
              </button>
            </div>
            <div className="pl-6">
              <BeltPips
                rate={belt.rate}
                onPick={(rate) => setInput(belt.id, { rate })}
              />
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Outputs"
        total={totalOut}
        onAdd={addOutput}
        addLabel="+ Add output belt"
        hint={
          over
            ? `Outputs exceed input (${totalIn}/min) — reduce the rates or add input.`
            : undefined
        }
      >
        {outputs.map((belt, i) => {
          const share = totalIn > 0 ? (belt.rate / totalIn) * 100 : 0
          return (
            <div key={belt.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-4 text-right text-xs tabular-nums text-zinc-600">
                  {i + 1}
                </span>
                <RateInput
                  value={belt.rate}
                  onChange={(rate) => setOutput(belt.id, { rate })}
                />
                <span className="text-xs text-zinc-500">/min</span>
                {share > 0 && (
                  <span className="text-[10px] tabular-nums text-zinc-600">
                    {share.toFixed(share < 10 ? 1 : 0)}%
                  </span>
                )}
                <button
                  type="button"
                  aria-label="Remove output"
                  onClick={() => removeOutput(belt.id)}
                  className="ml-auto rounded-md px-1 text-zinc-600 transition-colors hover:text-red-400"
                >
                  ×
                </button>
              </div>
              <div className="pl-6">
                <BeltPips
                  rate={belt.rate}
                  onPick={(rate) => setOutput(belt.id, { rate })}
                />
              </div>
            </div>
          )
        })}
      </Section>

      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Max belt tier
          </h2>
          <span className="text-xs tabular-nums text-zinc-500">
            up to {BELT_LABELS[maxMk - 1]}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5"
          role="group"
          aria-label="Max belt tier"
        >
          {BELT_LABELS.map((label, i) => {
            const mk = i + 1
            const active = mk === maxMk
            return (
              <button
                key={label}
                type="button"
                aria-label={`Set max belt ${label}`}
                aria-pressed={active}
                onClick={() => setMaxMk(mk)}
                className={`h-6 flex-1 rounded-md border text-[11px] font-semibold tabular-nums transition-colors ${
                  active
                    ? 'border-zinc-400 bg-zinc-700 text-zinc-100'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {mk}
              </button>
            )
          })}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Every belt the design places (including taps and overflow) fits this
          tier. Your input belts are exempt.
        </p>
      </section>

      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Snap tolerance
          </h2>
          <span className="text-xs tabular-nums text-zinc-500">
            ±{(tolerance * 100).toFixed(1)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={tolerance * 100}
          onChange={(e) => setTolerance(Number(e.target.value) / 100)}
          className="w-full accent-amber-400"
          aria-label="Snap tolerance percent"
        />
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          Some ratios (e.g. exactly 1/5) cannot be built from equal splits and
          belt taps — those outputs snap to the nearest achievable rate within
          this tolerance.
        </p>
      </section>
    </div>
  )
}
