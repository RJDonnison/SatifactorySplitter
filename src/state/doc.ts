import type { Edge } from '@xyflow/react'
import { BELT_HEX } from '../diagram/belts'
import {
  layoutSolution,
  slotPct,
  type SolutionNodeType,
} from '../diagram/layout'
import { F } from '../solver/frac'
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
export function mapDocToFlow(doc: NetDoc): {
  nodes: SolutionNodeType[]
  edges: Edge[]
} {
  const fmt = (r: number) =>
    `${Number.isInteger(r) ? r : Number(r.toFixed(2))}/min`
  const nodes = doc.nodes.map((n): SolutionNodeType => {
    const base = { id: n.id, position: { x: n.x, y: n.y }, draggable: true }
    switch (n.kind) {
      case 'source':
        return { ...base, type: 'source', data: { rate: fmt(n.rate) } }
      case 'sink':
        return {
          ...base,
          type: 'sink',
          data: { label: n.label, rate: fmt(n.rate), approximate: false },
        }
      case 'overflow':
        return { ...base, type: 'overflow', data: { rate: '' } }
      case 'splitter':
        return {
          ...base,
          type: 'splitter',
          data: {
            inRate: null,
            ports: n.ports.map((p, i) => ({
              hex: p.limited ? BELT_HEX[p.mk - 1] : '#3f3f46',
              tapMk: p.limited ? p.mk : null,
              port: i,
              top: slotPct(i, n.ports.length),
            })),
          },
        }
      case 'merger':
        return {
          ...base,
          type: 'merger',
          data: { inputTops: [0, 1, 2].map((p) => slotPct(p, 3)) },
        }
    }
  })
  const edges: Edge[] = doc.edges.map((e) => ({
    id: e.id,
    source: e.src,
    target: e.dst,
    sourceHandle: `p${e.srcPort}`,
    targetHandle: `p${e.dstPort}`,
    style: { stroke: '#71717a', strokeWidth: 2 },
  }))
  return { nodes, edges }
}
