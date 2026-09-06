import ELK from 'elkjs/lib/elk.bundled.js'
import type { Edge, Node } from '@xyflow/react'
import { formatFrac } from '../solver/frac'
import type { NetEdge, NetNode, Solution } from '../solver/types'
import { BELT_HEX } from './belts'

export interface SourceData extends Record<string, unknown> {
  rate: string
}
export interface SinkData extends Record<string, unknown> {
  label: string
  rate: string
  approximate: boolean
}
export interface OverflowData extends Record<string, unknown> {
  rate: string
}
export interface SplitterData extends Record<string, unknown> {
  inRate: string | null
  ports: { hex: string; tapMk: number | null; port: number; top: string }[]
}
export interface MergerData extends Record<string, unknown> {
  inputTops: string[]
}

export type SolutionNodeType =
  | Node<SourceData, 'source'>
  | Node<SinkData, 'sink'>
  | Node<OverflowData, 'overflow'>
  | Node<SplitterData, 'splitter'>
  | Node<MergerData, 'merger'>

export interface BeltInfo {
  hex: string
  label: string
}

export function beltInfo(e: NetEdge): BeltInfo {
  if (e.tapMk !== null)
    return { hex: BELT_HEX[e.tapMk - 1], label: `Mk.${e.tapMk} tap` }
  // non-tap belts share one neutral color; the label still states the minimum tier
  if (e.minMk !== null && e.minMk > 1)
    return { hex: BELT_HEX[0], label: `Mk.${e.minMk}+` }
  return { hex: BELT_HEX[0], label: 'any belt' }
}

const SIZES: Record<NetNode['kind'], { w: number; h: number }> = {
  source: { w: 184, h: 60 },
  sink: { w: 184, h: 68 },
  overflow: { w: 184, h: 60 },
  splitter: { w: 64, h: 96 },
  merger: { w: 64, h: 96 },
}

const elk = new ELK()

export async function layoutSolution(sol: Solution): Promise<{
  nodes: SolutionNodeType[]
  edges: Edge[]
}> {
  const children = sol.nodes.map((n) => {
    const s = SIZES[n.kind]
    return { id: n.id, width: s.w, height: s.h }
  })
  const elkEdges = sol.edges.map((e) => ({
    id: e.id,
    sources: [e.src],
    targets: [e.dst],
  }))
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '150',
      'elk.spacing.nodeNode': '72',
      'elk.spacing.edgeEdge': '24',
      'elk.spacing.edgeNode': '36',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children,
    edges: elkEdges,
  })
  const pos = new Map(
    (graph.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
  )

  const yOf = (id: string) => (pos.get(id) ?? { x: 0, y: 0 }).y

  // Rank each splitter's output slots (and each merger's input slots) by the
  // vertical position of the node on the other end, so belts fan out in order
  // instead of crossing over each other.
  const outTop = new Map<string, string>()
  for (const n of sol.nodes) {
    if (n.kind !== 'splitter') continue
    const outs = sol.edges
      .filter((e) => e.src === n.id)
      .sort(
        (a, b) =>
          yOf(a.dst) - yOf(b.dst) ||
          a.dstPort - b.dstPort ||
          a.srcPort - b.srcPort,
      )
    outs.forEach((e, rank) => {
      outTop.set(
        `${e.src}:${e.srcPort}`,
        `${(((rank + 1) / (outs.length + 1)) * 100).toFixed(2)}%`,
      )
    })
  }
  const MERGER_SLOTS = ['25%', '50%', '75%']
  const inTop = new Map<string, string>()
  for (const n of sol.nodes) {
    if (n.kind !== 'merger') continue
    const ins = sol.edges
      .filter((e) => e.dst === n.id)
      .sort(
        (a, b) =>
          yOf(a.src) - yOf(b.src) ||
          a.srcPort - b.srcPort ||
          a.dstPort - b.dstPort,
      )
    ins.forEach((e, rank) => {
      inTop.set(`${e.dst}:${e.dstPort}`, MERGER_SLOTS[rank] ?? '75%')
    })
  }

  const inRateOf = (id: string): string | null => {
    const e = sol.edges.find((x) => x.dst === id && x.dstPort === 0)
    return e ? formatFrac(e.rate) : null
  }

  const nodes: SolutionNodeType[] = sol.nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: 0, y: 0 }
    const base = { id: n.id, position: p, draggable: true }
    switch (n.kind) {
      case 'source':
        return {
          ...base,
          type: 'source',
          data: { rate: `${formatFrac(n.rate)}/min` },
        }
      case 'sink':
        return {
          ...base,
          type: 'sink',
          data: {
            label: `Output ${sol.outputIds.indexOf(n.target) + 1}`,
            rate: `${formatFrac(n.rate)}/min`,
            approximate: n.approximate,
          },
        }
      case 'overflow':
        return {
          ...base,
          type: 'overflow',
          data: { rate: `${formatFrac(n.rate)}/min` },
        }
      case 'splitter':
        return {
          ...base,
          type: 'splitter',
          data: {
            inRate: inRateOf(n.id),
            ports: n.ports
              .map((port, portIndex) => ({
                hex: port.limited ? BELT_HEX[port.mk - 1] : '#3f3f46',
                tapMk: port.limited ? port.mk : null,
                port: portIndex,
                top:
                  outTop.get(`${n.id}:${portIndex}`) ??
                  `${(((portIndex + 1) / (n.ports.length + 1)) * 100).toFixed(2)}%`,
              }))
              .sort((a, b) => parseFloat(a.top) - parseFloat(b.top)),
          },
        }
      case 'merger':
        return {
          ...base,
          type: 'merger',
          data: {
            inputTops: [0, 1, 2].map(
              (p) => inTop.get(`${n.id}:${p}`) ?? MERGER_SLOTS[p],
            ),
          },
        }
    }
  })

  const edges: Edge[] = sol.edges.map((e) => {
    const info = beltInfo(e)
    // plain belts carry only their rate; taps also name the limiting belt
    const label =
      e.tapMk !== null
        ? `${formatFrac(e.rate)} · ${info.label}`
        : formatFrac(e.rate)
    return {
      id: e.id,
      source: e.src,
      target: e.dst,
      sourceHandle: `p${e.srcPort}`,
      targetHandle: `p${e.dstPort}`,
      type: 'smoothstep',
      label,
      style: { stroke: info.hex, strokeWidth: 2 },
      labelStyle: { fill: '#a1a1aa', fontSize: 10 },
      labelBgStyle: { fill: '#09090b' },
      labelBgPadding: [5, 2] as [number, number],
      labelBgBorderRadius: 4,
      pathOptions: { borderRadius: 10 },
    }
  })

  return { nodes, edges }
}
