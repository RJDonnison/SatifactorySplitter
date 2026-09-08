import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type {
  MergerData,
  OverflowData,
  SinkData,
  SolutionNodeType,
  SourceData,
  SplitterData,
} from './layout'

const handleBase =
  '!h-2 !w-2 !border-0 !min-h-0 !min-w-0 transition-transform hover:scale-125'

function SourceView({ data }: NodeProps<Node<SourceData, 'source'>>) {
  return (
    <div className="flex h-[60px] w-[184px] flex-col justify-center rounded-xl border border-emerald-500/40 bg-zinc-900 px-3 shadow-lg shadow-black/40">
      <span className="text-[10px] font-medium uppercase tracking-widest text-emerald-400/90">
        Input
      </span>
      <span className="text-sm font-semibold text-zinc-100">{data.rate}</span>
      <Handle
        type="source"
        position={Position.Right}
        id="p0"
        className={`${handleBase} !bg-emerald-400`}
      />
    </div>
  )
}

function SinkView({ data }: NodeProps<Node<SinkData, 'sink'>>) {
  return (
    <div
      className={`flex h-[68px] w-[184px] flex-col justify-center rounded-xl border bg-zinc-900 px-3 shadow-lg shadow-black/40 ${
        data.approximate ? 'border-amber-500/40' : 'border-sky-500/40'
      }`}
    >
      <span
        className={`text-[10px] font-medium uppercase tracking-widest ${
          data.approximate ? 'text-amber-400/90' : 'text-sky-400/90'
        }`}
      >
        {data.label} {data.approximate && '· approx'}
      </span>
      <span className="text-sm font-semibold text-zinc-100">{data.rate}</span>
      <Handle
        type="target"
        position={Position.Left}
        id="p0"
        className={`${handleBase} !bg-sky-400`}
      />
    </div>
  )
}

function OverflowView({ data }: NodeProps<Node<OverflowData, 'overflow'>>) {
  return (
    <div className="flex h-[60px] w-[184px] flex-col justify-center rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 px-3">
      <span className="text-[10px] font-medium uppercase tracking-widest text-amber-400/90">
        Overflow
      </span>
      <span className="text-sm font-semibold text-zinc-100">{data.rate}</span>
      <Handle
        type="target"
        position={Position.Left}
        id="p0"
        className={`${handleBase} !bg-amber-400`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="p0"
        className={`${handleBase} !bg-amber-400`}
      />
    </div>
  )
}

function SplitterView({ data }: NodeProps<Node<SplitterData, 'splitter'>>) {
  return (
    <div className="flex h-24 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/40">
      <Handle
        type="target"
        position={Position.Left}
        id="p0"
        className={`${handleBase} !bg-zinc-400`}
      />
      {data.inRate && (
        <span className="text-[10px] font-medium tabular-nums text-zinc-400">
          {data.inRate}
        </span>
      )}
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 text-zinc-500"
        aria-hidden="true"
      >
        <path
          d="M3 12h6M9 12l6-6M9 12l6 6M15 6h6M15 18h6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <div className="flex flex-col gap-1.5">
        {data.ports.map((p) => (
          <span key={p.port} className="group relative flex items-center">
            <span
              className="block h-1.5 w-4 rounded-full"
              style={{ backgroundColor: p.hex }}
            />
            <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 opacity-0 shadow-lg shadow-black/50 group-hover:opacity-100">
              {p.tapMk ? `Mk.${p.tapMk} tap` : 'open port'}
            </span>
          </span>
        ))}
      </div>
      {data.ports.map((p) => (
        <Handle
          key={`h${p.port}`}
          type="source"
          position={Position.Right}
          id={`p${p.port}`}
          style={{ top: p.top, backgroundColor: p.hex }}
          className={handleBase}
        />
      ))}
    </div>
  )
}

function MergerView({ data }: NodeProps<Node<MergerData, 'merger'>>) {
  return (
    <div className="flex h-24 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-fuchsia-500/60 bg-fuchsia-500/5 shadow-lg shadow-black/40">
      <Handle
        type="source"
        position={Position.Right}
        id="p0"
        className={`${handleBase} !bg-fuchsia-400`}
      />
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 -scale-x-100 text-fuchsia-400"
        aria-hidden="true"
      >
        <path
          d="M3 12h6M9 12l6-6M9 12l6 6M15 6h6M15 18h6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="text-[8px] font-semibold uppercase tracking-widest text-fuchsia-300/90">
        Merge
      </span>
      {(data.inputTops?.length ? data.inputTops : ['50%']).map((top, p) => (
        <Handle
          key={p}
          type="target"
          position={Position.Left}
          id={`p${p}`}
          style={{ top }}
          className={`${handleBase} !bg-fuchsia-400`}
        />
      ))}
    </div>
  )
}

export const nodeTypes = {
  source: SourceView,
  sink: SinkView,
  overflow: OverflowView,
  splitter: SplitterView,
  merger: MergerView,
}

export type { SolutionNodeType }
