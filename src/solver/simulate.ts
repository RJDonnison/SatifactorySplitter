import { F, frac, formatFrac, type Frac } from './frac'
import { minMkFor, speedOf } from './gameData'
import { portRates } from './verify'
import type { PortSpec, Warning } from './types'

/**
 * Structural mirror of the manual-mode doc (src/state/doc.ts) so this module
 * stays free of view imports — NetDoc satisfies these shapes directly.
 */
export interface SimEdge {
  id: string
  src: string
  srcPort: number
  dst: string
  dstPort: number
  /** belt Mk the user pinned; null = auto */
  mk: number | null
}
export interface SimNode {
  id: string
  kind: 'source' | 'sink' | 'overflow' | 'splitter' | 'merger'
  rate?: number
  ports?: PortSpec[]
}
export interface SimDoc {
  nodes: SimNode[]
  edges: SimEdge[]
}

export interface SinkSim {
  achieved: Frac
  requested: Frac
}
export interface ValveSim {
  inflow: Frac
  outflow: Frac
  discarded: Frac
}

export interface SimResult {
  /** belt rate per edge id; an edge absent from the map carries no flow */
  edges: Map<string, Frac>
  sinks: Map<string, SinkSim>
  valves: Map<string, ValveSim>
  warnings: Warning[]
}

/** doc rates are plain user numbers — lift them to exact rationals (1e-6/min precision) */
const numToFrac = (n: number): Frac => {
  if (!Number.isFinite(n) || n <= 0) return frac(0)
  return frac(BigInt(Math.round(n * 1e6)), 1_000_000n)
}

const sum = (xs: Frac[]): Frac => xs.reduce((a, b) => F.add(a, b), frac(0))
const fmt = (f: Frac) => `${formatFrac(f)}/min`

/**
 * Live steady-state evaluation of a manual layout.
 *
 * Flow originates at sources, splits at splitters (the solver's
 * back-pressure model over the connected ports only), sums at mergers, and
 * passes through valves capped at the fastest allowed belt. Acyclic graphs
 * resolve in one topological pass; loops resolve by monotone fixed-point
 * iteration from zero, which converges when every loop loses flow through a
 * splitter share, a tap, or a valve — otherwise an error is raised.
 * Partial mid-edit graphs produce warnings; this never throws.
 */
export function simulate(doc: SimDoc, maxMk = 6): SimResult {
  const warnTexts: string[] = []
  const warn = (level: Warning['level'], text: string) =>
    warnTexts.push(`${level}\u0000${text}`)

  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  const live = doc.edges.filter(
    (e) => nodeById.has(e.src) && nodeById.has(e.dst),
  )
  const outs = new Map<string, SimEdge[]>()
  const ins = new Map<string, SimEdge[]>()
  for (const e of live) {
    if (!outs.has(e.src)) outs.set(e.src, [])
    outs.get(e.src)!.push(e)
    if (!ins.has(e.dst)) ins.set(e.dst, [])
    ins.get(e.dst)!.push(e)
  }
  const inEdges = (id: string) => ins.get(id) ?? []
  const outEdges = (id: string) => outs.get(id) ?? []

  // ---- topological order (Kahn): a node settles once every upstream node did
  const deps = new Map<string, Set<string>>()
  for (const n of doc.nodes)
    deps.set(n.id, new Set(inEdges(n.id).map((e) => e.src)))
  const settled = new Set<string>()
  const queue = doc.nodes
    .map((n) => n.id)
    .filter((id) => deps.get(id)!.size === 0)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!
    if (settled.has(id)) continue
    settled.add(id)
    order.push(id)
    for (const o of outEdges(id)) {
      const d = deps.get(o.dst)!
      d.delete(id)
      if (d.size === 0) queue.push(o.dst)
    }
  }

  const rates = new Map<string, Frac>() // edge id -> rate
  const rateOf = (e: SimEdge): Frac => rates.get(e.id) ?? frac(0)
  const sinks = new Map<string, SinkSim>()
  const valves = new Map<string, ValveSim>()
  const valveCap = frac(speedOf(maxMk))

  /** evaluate one node from the current edge rates (idempotent, pure) */
  const evalNode = (n: SimNode) => {
    switch (n.kind) {
      case 'source': {
        const r = numToFrac(n.rate ?? 0)
        const o = outEdges(n.id)[0]
        if (o) rates.set(o.id, r)
        else if (!F.isZero(r))
          warn(
            'info',
            `input belt runs ${fmt(r)} but is not connected to anything`,
          )
        return
      }
      case 'splitter': {
        const i = inEdges(n.id)[0]
        const r = i ? rateOf(i) : frac(0)
        const o = outEdges(n.id)
        if (o.length === 0) {
          if (!F.isZero(r))
            warn('warn', `splitter receives ${fmt(r)} but has no output belts`)
          return
        }
        const pr = portRates(
          r,
          o.map((e) => n.ports?.[e.srcPort] ?? { limited: false }),
        )
        if (pr === null) {
          // every port is a limited tap that cannot absorb the inflow
          warn(
            'warn',
            `splitter stalls: ${fmt(r)} arrives but the taps cannot carry it all away`,
          )
          for (const e of o) {
            const p = n.ports?.[e.srcPort]
            rates.set(e.id, frac(p?.limited ? speedOf(p.mk) : 0))
          }
          return
        }
        o.forEach((e, k) => rates.set(e.id, pr[k] ?? frac(0)))
        return
      }
      case 'merger': {
        const r = sum(inEdges(n.id).map(rateOf))
        const o = outEdges(n.id)[0]
        if (o) rates.set(o.id, r)
        else if (!F.isZero(r))
          warn(
            'warn',
            `merger combines ${fmt(r)} but its output is not connected`,
          )
        return
      }
      case 'overflow': {
        const r = sum(inEdges(n.id).map(rateOf))
        const out = F.cmp(r, valveCap) < 0 ? r : valveCap
        const discarded = F.sub(r, out)
        valves.set(n.id, { inflow: r, outflow: out, discarded })
        const o = outEdges(n.id)[0]
        if (o) rates.set(o.id, out)
        else if (!F.isZero(r))
          warn('info', `overflow valve ends a line carrying ${fmt(r)}`)
        if (!F.isZero(discarded))
          warn(
            'warn',
            `overflow valve discards ${fmt(discarded)} — more than a Mk.${maxMk} belt carries`,
          )
        return
      }
      case 'sink': {
        sinks.set(n.id, {
          achieved: sum(inEdges(n.id).map(rateOf)),
          requested: numToFrac(n.rate ?? 0),
        })
        return
      }
    }
  }

  // ---- pass 1: acyclic nodes in topological order (exact)
  for (const id of order) evalNode(nodeById.get(id)!)

  // ---- pass 2: loops and their downstream, monotone fixed-point from zero
  const cyclic = doc.nodes.filter((n) => !settled.has(n.id))
  if (cyclic.length) {
    for (let iter = 0; ; iter++) {
      let delta = 0
      for (const n of cyclic) {
        const outsNow = outEdges(n.id).map(rateOf)
        evalNode(n)
        outEdges(n.id).forEach((e, k) => {
          delta = Math.max(
            delta,
            Math.abs(F.toNumber(rateOf(e)) - F.toNumber(outsNow[k])),
          )
        })
      }
      if (delta < 1e-7) break
      if (iter >= 400) {
        warn(
          'error',
          'a belt loop feeds back into itself with nothing limiting the flow — add a splitter, tap, or overflow valve inside the loop',
        )
        break
      }
    }
  }

  // ---- belt sizing on every flowing edge (warn, never forbid)
  for (const e of live) {
    const r = rateOf(e)
    if (F.isZero(r)) continue
    if (e.mk !== null && F.toNumber(r) > speedOf(e.mk))
      warn(
        'warn',
        `a belt pinned to Mk.${e.mk} carries at most ${speedOf(e.mk)}/min but ${formatFrac(r)}/min runs through it`,
      )
    else if (minMkFor(r, maxMk) === null)
      warn(
        'warn',
        `${formatFrac(r)}/min exceeds even a Mk.${maxMk} belt (${speedOf(maxMk)}/min)`,
      )
  }

  // ---- sink verdicts (achieved vs requested)
  for (const [id, s] of sinks) {
    if (inEdges(id).length === 0 && !F.isZero(s.requested))
      warn('warn', `output wants ${fmt(s.requested)} but receives nothing`)
    else if (F.cmp(F.sub(s.achieved, s.requested), frac(-1n, 1000n)) < 0)
      warn(
        'warn',
        `output is under-supplied: receives ${fmt(s.achieved)} of ${fmt(s.requested)}`,
      )
    else if (F.cmp(F.sub(s.achieved, s.requested), frac(1n, 50n)) > 0)
      warn(
        'warn',
        `output is over-supplied: receives ${fmt(s.achieved)} but only wants ${fmt(s.requested)}`,
      )
  }

  // the fixed-point pass evaluates loop nodes repeatedly — collapse dupes
  const seen = new Set<string>()
  const warnings: Warning[] = []
  for (const entry of warnTexts) {
    const [level, text] = entry.split('\u0000')
    if (seen.has(entry)) continue
    seen.add(entry)
    warnings.push({ level: level as Warning['level'], text })
  }
  return { edges: rates, sinks, valves, warnings }
}
