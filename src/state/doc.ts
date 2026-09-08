import type { Edge } from '@xyflow/react'
import { BELT_HEX } from '../diagram/belts'
import {
  layoutSolution,
  slotPct,
  type SolutionNodeType,
} from '../diagram/layout'
import { F, formatFrac, frac } from '../solver/frac'
import { minMkFor, speedOf } from '../solver/gameData'
import type { SimResult } from '../solver/simulate'
import type { PortSpec, Solution } from '../solver/types'

/**
 * Manual-editing document.
 *
 * The doc is intent-only: it records what the user placed and connected —
 * never computed flow rates (those derive from the doc on render) and never
 * solver bookkeeping (minMk/tapMk on edges). Positions are part of the doc
 * so layouts can be shared via the URL.
 */

export type DocNode =
  | { id: string; kind: 'source'; rate: number; x: number; y: number }
  | {
      id: string
      kind: 'sink'
      label: string
      rate: number
      x: number
      y: number
    }
  | { id: string; kind: 'overflow'; x: number; y: number }
  | { id: string; kind: 'splitter'; ports: PortSpec[]; x: number; y: number }
  | { id: string; kind: 'merger'; x: number; y: number }

export interface DocEdge {
  id: string
  src: string
  srcPort: number
  dst: string
  dstPort: number
  /** belt Mk the user pinned for this belt; null = pick the minimum that fits */
  mk: number | null
}

export interface NetDoc {
  nodes: DocNode[]
  edges: DocEdge[]
}

let seq = 0
const uid = (p: string) => `${p}${++seq}`

/** number of output ports a node kind exposes */
export const outPorts = (n: DocNode): number =>
  n.kind === 'sink' ? 0 : n.kind === 'splitter' ? n.ports.length : 1

/** number of input ports a node kind exposes */
export const inPorts = (n: DocNode): number =>
  n.kind === 'source' ? 0 : n.kind === 'merger' ? 3 : 1

/**
 * Draw-time connection rules: output port → input port, no self-loop, ports
 * in range, and each port carries at most one belt on each side.
 */
export function canConnect(
  doc: NetDoc,
  src: string,
  srcPort: number,
  dst: string,
  dstPort: number,
): boolean {
  if (src === dst) return false
  const a = doc.nodes.find((n) => n.id === src)
  const b = doc.nodes.find((n) => n.id === dst)
  if (!a || !b) return false
  if (srcPort < 0 || srcPort >= outPorts(a)) return false
  if (dstPort < 0 || dstPort >= inPorts(b)) return false
  return (
    !doc.edges.some((e) => e.src === src && e.srcPort === srcPort) &&
    !doc.edges.some((e) => e.dst === dst && e.dstPort === dstPort)
  )
}

export const addNode = (d: NetDoc, n: DocNode): NetDoc => ({
  ...d,
  nodes: [...d.nodes, n],
})

export function connectEdge(
  d: NetDoc,
  src: string,
  srcPort: number,
  dst: string,
  dstPort: number,
): NetDoc {
  return {
    ...d,
    edges: [
      ...d.edges,
      { id: uid('de'), src, srcPort, dst, dstPort, mk: null },
    ],
  }
}

/** remove nodes and every belt touching them */
export const removeNodes = (d: NetDoc, ids: string[]): NetDoc => {
  const dead = new Set(ids)
  return {
    nodes: d.nodes.filter((n) => !dead.has(n.id)),
    edges: d.edges.filter((e) => !dead.has(e.src) && !dead.has(e.dst)),
  }
}

export const removeEdges = (d: NetDoc, ids: string[]): NetDoc => {
  const dead = new Set(ids)
  return { ...d, edges: d.edges.filter((e) => !dead.has(e.id)) }
}

export const moveNode = (
  d: NetDoc,
  id: string,
  x: number,
  y: number,
): NetDoc => ({
  ...d,
  nodes: d.nodes.map((n) => (n.id === id ? ({ ...n, x, y } as DocNode) : n)),
})

export const newSource = (x: number, y: number): DocNode => ({
  id: uid('n'), // doc-local ids never collide with snapshot solver ids (src/sp/mg/sink/ovf)
  kind: 'source',
  rate: 60,
  x,
  y,
})

export const newSink = (x: number, y: number): DocNode => ({
  id: uid('n'),
  kind: 'sink',
  label: 'Output',
  rate: 60,
  x,
  y,
})

export const newValve = (x: number, y: number): DocNode => ({
  id: uid('n'),
  kind: 'overflow',
  x,
  y,
})

export const newSplitter = (ports: 2 | 3, x: number, y: number): DocNode => ({
  id: uid('n'),
  kind: 'splitter',
  ports: Array.from({ length: ports }, () => ({ limited: false })),
  x,
  y,
})

export const newMerger = (x: number, y: number): DocNode => ({
  id: uid('n'),
  kind: 'merger',
  x,
  y,
})

/**
 * Snapshot a solved layout into an editable doc, keeping the canvas
 * positions the user currently sees. An unsolvable problem yields a blank
 * doc (blank-canvas entry).
 */
export async function snapshotDoc(sol: Solution): Promise<NetDoc> {
  if (!sol.ok) return { nodes: [], edges: [] }
  const laid = await layoutSolution(sol)
  const pos = new Map(laid.nodes.map((n) => [n.id, n.position]))
  const at = (id: string) => pos.get(id) ?? { x: 0, y: 0 }
  const nodes: DocNode[] = sol.nodes.map((n): DocNode => {
    const p = at(n.id)
    switch (n.kind) {
      case 'source':
        return {
          id: n.id,
          kind: 'source',
          rate: F.toNumber(n.rate),
          x: p.x,
          y: p.y,
        }
      case 'sink':
        return {
          id: n.id,
          kind: 'sink',
          label: `Output ${sol.outputIds.indexOf(n.target) + 1}`,
          rate: F.toNumber(n.rate),
          x: p.x,
          y: p.y,
        }
      case 'overflow':
        return { id: n.id, kind: 'overflow', x: p.x, y: p.y }
      case 'splitter':
        return {
          id: n.id,
          kind: 'splitter',
          ports: n.ports.map((q) => ({ ...q })),
          x: p.x,
          y: p.y,
        }
      case 'merger':
        return { id: n.id, kind: 'merger', x: p.x, y: p.y }
    }
  })
  const edges: DocEdge[] = sol.edges.map((e) => ({
    id: e.id,
    src: e.src,
    srcPort: e.srcPort,
    dst: e.dst,
    dstPort: e.dstPort,
    mk: null,
  }))
  return { nodes, edges }
}

/** map the intent-only doc onto xyflow nodes/edges for the shared node views */
export function mapDocToFlow(
  doc: NetDoc,
  sim?: SimResult | null,
): {
  nodes: SolutionNodeType[]
  edges: Edge[]
} {
  const fmt = (r: number) =>
    `${Number.isInteger(r) ? r : Number(r.toFixed(2))}/min`
  const inEdgeOf = (id: string) => doc.edges.find((e) => e.dst === id)
  const nodes = doc.nodes.map((n): SolutionNodeType => {
    const base = { id: n.id, position: { x: n.x, y: n.y }, draggable: true }
    switch (n.kind) {
      case 'source':
        return { ...base, type: 'source', data: { rate: fmt(n.rate) } }
      case 'sink': {
        const s = sim?.sinks.get(n.id)
        if (!s)
          return {
            ...base,
            type: 'sink',
            data: { label: n.label, rate: fmt(n.rate), approximate: false },
          }
        const ok = F.cmp(F.sub(s.achieved, s.requested), frac(-1n, 1000n)) >= 0
        return {
          ...base,
          type: 'sink',
          data: {
            label: n.label,
            rate: ok
              ? `${formatFrac(s.achieved)}/min`
              : `${formatFrac(s.achieved)}/min · wants ${fmt(n.rate)}`,
            approximate: !ok,
          },
        }
      }
      case 'overflow': {
        const v = sim?.valves.get(n.id)
        const rate = v
          ? `${formatFrac(v.outflow)}/min${
              F.isZero(v.discarded) ? '' : ` −${formatFrac(v.discarded)} lost`
            }`
          : ''
        return { ...base, type: 'overflow', data: { rate } }
      }
      case 'splitter': {
        const inEdge = inEdgeOf(n.id)
        const inRate =
          sim && inEdge
            ? (() => {
                const r = sim.edges.get(inEdge.id)
                return r ? `${formatFrac(r)}/min` : null
              })()
            : null
        return {
          ...base,
          type: 'splitter',
          data: {
            inRate,
            ports: n.ports.map((p, i) => ({
              hex: p.limited ? BELT_HEX[p.mk - 1] : '#3f3f46',
              tapMk: p.limited ? p.mk : null,
              port: i,
              top: slotPct(i, n.ports.length),
            })),
          },
        }
      }
      case 'merger':
        return {
          ...base,
          type: 'merger',
          data: { inputTops: [0, 1, 2].map((p) => slotPct(p, 3)) },
        }
    }
  })
  const edges: Edge[] = doc.edges.map((e) => {
    const r = sim?.edges.get(e.id)
    if (!r || F.isZero(r))
      return {
        id: e.id,
        source: e.src,
        target: e.dst,
        sourceHandle: `p${e.srcPort}`,
        targetHandle: `p${e.dstPort}`,
        style: { stroke: '#3f3f46', strokeWidth: 2 },
      }
    const v = F.toNumber(r)
    const fitsMax = minMkFor(r, 6) !== null
    const fitsPin = e.mk === null || v <= speedOf(e.mk)
    const mk = e.mk ?? minMkFor(r, 6)!
    const stroke = !fitsMax || !fitsPin ? '#ef4444' : BELT_HEX[mk - 1]
    return {
      id: e.id,
      source: e.src,
      target: e.dst,
      sourceHandle: `p${e.srcPort}`,
      targetHandle: `p${e.dstPort}`,
      label: `${formatFrac(r)}/min`,
      labelStyle: { fill: '#a1a1aa', fontSize: 10 },
      labelBgStyle: { fill: '#09090b' },
      style: { stroke, strokeWidth: 2 },
    }
  })
  return { nodes, edges }
}

/** set the rate of a source or sink node */
export const setNodeRate = (d: NetDoc, id: string, rate: number): NetDoc => ({
  ...d,
  nodes: d.nodes.map((n) =>
    n.id === id &&
    n.kind !== 'overflow' &&
    n.kind !== 'splitter' &&
    n.kind !== 'merger'
      ? ({ ...n, rate } as DocNode)
      : n,
  ),
})

export const setSinkLabel = (d: NetDoc, id: string, label: string): NetDoc => ({
  ...d,
  nodes: d.nodes.map((n) =>
    n.id === id && n.kind === 'sink' ? { ...n, label } : n,
  ),
})

/** pin a splitter port to a tap Mk (null = plain open port) */
export const setPortTap = (
  d: NetDoc,
  id: string,
  port: number,
  mk: number | null,
): NetDoc => ({
  ...d,
  nodes: d.nodes.map((n) =>
    n.id === id && n.kind === 'splitter' && n.ports[port]
      ? {
          ...n,
          ports: n.ports.map((p, i) =>
            i === port
              ? mk === null
                ? { limited: false }
                : { limited: true, mk }
              : p,
          ),
        }
      : n,
  ),
})

/** resize a splitter between 2 and 3 ports, dropping belts from removed ports */
export const setSplitterPorts = (
  d: NetDoc,
  id: string,
  count: 2 | 3,
): NetDoc => ({
  ...d,
  nodes: d.nodes.map((n) =>
    n.id === id && n.kind === 'splitter'
      ? {
          ...n,
          ports:
            n.ports.length === count
              ? n.ports
              : n.ports.length < count
                ? [...n.ports, { limited: false }]
                : n.ports.slice(0, count),
        }
      : n,
  ),
  edges:
    d.nodes.find((n) => n.id === id)?.kind === 'splitter'
      ? d.edges.filter((e) => !(e.src === id && e.srcPort >= count))
      : d.edges,
})

/** pin a belt to a Mk (null = auto-minimum) */
export const setEdgeMk = (
  d: NetDoc,
  edgeId: string,
  mk: number | null,
): NetDoc => ({
  ...d,
  edges: d.edges.map((e) => (e.id === edgeId ? { ...e, mk } : e)),
})

/**
 * Auto-arrange: run the ELK layered layout over the doc's structure (rates
 * are irrelevant to topology) and adopt the resulting positions.
 */
export async function autoArrangeDoc(d: NetDoc): Promise<NetDoc> {
  const zero = frac(0)
  const pseudo: Solution = {
    ok: true,
    nodes: d.nodes.map((n): Solution['nodes'][number] => {
      switch (n.kind) {
        case 'source':
          return { id: n.id, kind: 'source', rate: zero }
        case 'sink':
          return {
            id: n.id,
            kind: 'sink',
            target: n.id,
            rate: zero,
            approximate: false,
          }
        case 'overflow':
          return { id: n.id, kind: 'overflow', rate: zero }
        case 'splitter':
          return { id: n.id, kind: 'splitter', ports: n.ports }
        case 'merger':
          return { id: n.id, kind: 'merger' }
      }
    }),
    edges: d.edges.map((e) => ({
      id: e.id,
      src: e.src,
      srcPort: e.srcPort,
      dst: e.dst,
      dstPort: e.dstPort,
      rate: zero,
      minMk: 1,
      tapMk: null,
    })),
    warnings: [],
    inputRate: zero,
    outputIds: [],
    buildings: { splitters: 0, mergers: 0 },
    excess: 0,
    approximateCount: 0,
  }
  const laid = await layoutSolution(pseudo)
  const pos = new Map(laid.nodes.map((n) => [n.id, n.position]))
  let out = d
  for (const n of d.nodes) {
    const p = pos.get(n.id)
    if (p) out = moveNode(out, n.id, p.x, p.y)
  }
  return out
}
