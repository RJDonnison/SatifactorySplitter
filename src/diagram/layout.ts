import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs'
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

/** dim neutral for plain belts so tier colors (incl. Mk.1 taps) stand out */
const PLAIN_BELT_HEX = '#52525b'

export function beltInfo(e: NetEdge): BeltInfo {
  if (e.tapMk !== null)
    return { hex: BELT_HEX[e.tapMk - 1], label: `Mk.${e.tapMk} tap` }
  // non-tap belts share one neutral color; the label still states the minimum tier
  if (e.minMk !== null && e.minMk > 1)
    return { hex: PLAIN_BELT_HEX, label: `Mk.${e.minMk}+` }
  return { hex: PLAIN_BELT_HEX, label: 'any belt' }
}

const SIZES: Record<NetNode['kind'], { w: number; h: number }> = {
  source: { w: 184, h: 60 },
  sink: { w: 184, h: 68 },
  overflow: { w: 184, h: 60 },
  splitter: { w: 64, h: 96 },
  merger: { w: 64, h: 96 },
}

const elk = new ELK()

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '150',
  'elk.spacing.nodeNode': '72',
  'elk.spacing.edgeEdge': '24',
  'elk.spacing.edgeNode': '36',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
}

const layoutElk = async (
  children: ElkNode[],
  edges: ElkExtendedEdge[],
  extra?: Record<string, string>,
) => {
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: { ...ELK_OPTIONS, ...extra },
    children,
    edges,
  })
  const pos = new Map(
    (graph.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
  )
  return { graph, pos }
}

const portRef = (
  id: string,
  x: number,
  y: number,
): { id: string; x: number; y: number; width: number; height: number } => ({
  id,
  x,
  y,
  width: 0,
  height: 0,
})

export async function layoutSolution(sol: Solution): Promise<{
  nodes: SolutionNodeType[]
  edges: Edge[]
}> {
  // pass 1: port-unaware layout to establish the vertical order of targets
  const { pos: pos1 } = await layoutElk(
    sol.nodes.map((n) => {
      const s = SIZES[n.kind]
      return { id: n.id, width: s.w, height: s.h }
    }),
    sol.edges.map((e) => ({ id: e.id, sources: [e.src], targets: [e.dst] })),
  )

  let rankPos = pos1
  const yOf = (id: string) => (rankPos.get(id) ?? { x: 0, y: 0 }).y

  const outTop = new Map<string, string>()
  const outRank = new Map<string, number>()
  const MERGER_SLOTS = ['25%', '50%', '75%']
  const inTop = new Map<string, string>()
  const inRank = new Map<string, number>()
  const fillRanks = () => {
    outTop.clear()
    outRank.clear()
    inTop.clear()
    inRank.clear()
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
        outRank.set(`${e.src}:${e.srcPort}`, rank)
      })
    }
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
        inRank.set(`${e.dst}:${e.dstPort}`, rank)
      })
    }
  }
  fillRanks()

  // pass 2: re-layout with FIXED_POS ports at the ranked handle slots, so the
  // layout engine sees the real anchor points and can order nodes to keep
  // long belts clear of intermediate splitters and mergers
  const kindOf = new Map(sol.nodes.map((n) => [n.id, n.kind]))
  const buildChildren = (): ElkNode[] =>
    sol.nodes.map((n) => {
      const s = SIZES[n.kind]
      const ports = []
      if (n.kind === 'source') {
        ports.push(portRef(`${n.id}__out`, s.w, s.h / 2))
      } else if (n.kind === 'sink' || n.kind === 'overflow') {
        ports.push(portRef(`${n.id}__in`, 0, s.h / 2))
      } else if (n.kind === 'splitter') {
        ports.push(portRef(`${n.id}__in`, 0, s.h / 2))
        const count = n.ports.length
        n.ports.forEach((_, i) => {
          const rank = outRank.get(`${n.id}:${i}`) ?? i
          ports.push(
            portRef(`${n.id}__p${i}`, s.w, ((rank + 1) / (count + 1)) * s.h),
          )
        })
      } else {
        for (let p = 0; p < 3; p++) {
          const rank = inRank.get(`${n.id}:${p}`) ?? p
          ports.push(portRef(`${n.id}__p${p}`, 0, ((rank + 1) / 4) * s.h))
        }
        ports.push(portRef(`${n.id}__out`, s.w, s.h / 2))
      }
      return { id: n.id, width: s.w, height: s.h, ports }
    })
  const endpoint = (nodeId: string, dir: 'out' | 'in', portIndex: number) => {
    const kind = kindOf.get(nodeId)
    if (kind === 'source') return `${nodeId}__out`
    if (kind === 'sink' || kind === 'overflow') return `${nodeId}__in`
    if (kind === 'splitter')
      return dir === 'in' ? `${nodeId}__in` : `${nodeId}__p${portIndex}`
    return dir === 'in' ? `${nodeId}__p${portIndex}` : `${nodeId}__out`
  }
  const elkEdges: ElkExtendedEdge[] = sol.edges.map((e) => ({
    id: e.id,
    sources: [endpoint(e.src, 'out', e.srcPort)],
    targets: [endpoint(e.dst, 'in', e.dstPort)],
  }))
  let graph2 = await layoutElk(buildChildren(), elkEdges, {
    'elk.layered.portConstraints': 'FIXED_POS',
  })
  let pos = graph2.pos
  for (let attempt = 0; attempt < 5; attempt++) {
    const prevOut = new Map(outRank)
    const prevIn = new Map(inRank)
    rankPos = pos
    fillRanks()
    const stable =
      [...outRank].every(([k, v]) => prevOut.get(k) === v) &&
      [...inRank].every(([k, v]) => prevIn.get(k) === v)
    if (stable) break
    graph2 = await layoutElk(buildChildren(), elkEdges, {
      'elk.layered.portConstraints': 'FIXED_POS',
    })
    pos = graph2.pos
  }
  // handle slots must match the positions we actually render, even when the
  // iteration above did not fully settle
  rankPos = pos
  fillRanks()

  // harvest ELK's orthogonal routes (they steer around nodes) as waypoints
  const waypoints = new Map<string, { x: number; y: number }[]>()
  for (const ge of graph2.graph.edges ?? []) {
    const pts: { x: number; y: number }[] = []
    for (const sec of ge.sections ?? []) {
      pts.push({ x: sec.startPoint.x, y: sec.startPoint.y })
      for (const b of sec.bendPoints ?? []) pts.push({ x: b.x, y: b.y })
      pts.push({ x: sec.endPoint.x, y: sec.endPoint.y })
    }
    if (pts.length >= 2) waypoints.set(ge.id, pts)
  }

  // ELK's orthogonal routes can still cut through an intermediate node box;
  // bend any offending segment around that box with a clearance detour,
  // keeping the node placement itself untouched
  const CLEAR = 16
  const edgeById = new Map(sol.edges.map((e) => [e.id, e]))
  const sizeOf = new Map(sol.nodes.map((n) => [n.id, SIZES[n.kind]]))
  type Pt = { x: number; y: number }
  const segCross = (
    a: Pt,
    b: Pt,
    bx: { l: number; t: number; r: number; b: number },
  ) => {
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    const y1 = Math.max(a.y, b.y)
    return x1 > bx.l && x0 < bx.r && y1 > bx.t && y0 < bx.b
  }
  const detour = (
    a: Pt,
    b: Pt,
    bx: { l: number; t: number; r: number; b: number },
  ) => {
    const pts: Pt[] = [a]
    if (Math.abs(a.y - b.y) < 1) {
      // horizontal segment: pass above or below the box, whichever is nearer
      const above =
        Math.abs(a.y - (bx.t - CLEAR)) <= Math.abs(a.y - (bx.b + CLEAR))
      const y = above ? bx.t - CLEAR : bx.b + CLEAR
      const fromLeft = Math.min(a.x, b.x) < bx.l
      const xa = fromLeft ? bx.l - CLEAR : bx.r + CLEAR
      const xb = fromLeft ? bx.r + CLEAR : bx.l - CLEAR
      pts.push({ x: xa, y: a.y }, { x: xa, y }, { x: xb, y }, { x: xb, y: b.y })
    } else {
      // vertical segment: pass left or right of the box, whichever is nearer
      const left =
        Math.abs(a.x - (bx.l - CLEAR)) <= Math.abs(a.x - (bx.r + CLEAR))
      const x = left ? bx.l - CLEAR : bx.r + CLEAR
      const fromTop = Math.min(a.y, b.y) < bx.t
      const ya = fromTop ? bx.t - CLEAR : bx.b + CLEAR
      const yb = fromTop ? bx.b + CLEAR : bx.t - CLEAR
      pts.push({ x: a.x, y: ya }, { x, y: ya }, { x, y: yb }, { x: b.x, y: yb })
    }
    pts.push(b)
    return pts
  }
  for (let round = 0; round < 4; round++) {
    let fixed = 0
    for (const [eid] of waypoints) {
      const edge = edgeById.get(eid)
      if (!edge) continue
      let pts = waypoints.get(eid)!
      for (const n of sol.nodes) {
        if (n.id === edge.src || n.id === edge.dst) continue
        const p = pos.get(n.id)
        const sz = sizeOf.get(n.id)
        if (!p || !sz) continue
        const bx = { l: p.x, t: p.y, r: p.x + sz.w, b: p.y + sz.h }
        const next: Pt[] = [pts[0]]
        for (let i = 1; i < pts.length; i++) {
          const a = next.pop()!
          const b = pts[i]
          if (segCross(a, b, bx)) {
            next.push(...detour(a, b, bx))
            fixed++
          } else {
            next.push(a, b)
          }
        }
        pts = next
      }
      waypoints.set(eid, pts)
    }
    if (fixed === 0) break
  }

  // pick each label spot with clearance from node boxes, preferring the
  // natural mid-point of the belt so labels do not hug handles or sit on
  // splitters, mergers and other nodes; then spread colliding labels apart
  const labelPos = new Map<string, { x: number; y: number }>()
  const distToBox = (
    p: { x: number; y: number },
    bx: { l: number; t: number; r: number; b: number },
  ) => {
    const dx = Math.max(bx.l - p.x, 0, p.x - bx.r)
    const dy = Math.max(bx.t - p.y, 0, p.y - bx.b)
    return Math.hypot(dx, dy)
  }
  const candsByEdge: {
    eid: string
    cands: { x: number; y: number; score: number }[]
  }[] = []
  for (const [eid, pts] of waypoints) {
    const boxes = sol.nodes
      .map((n) => {
        const p = pos.get(n.id)
        const sz = sizeOf.get(n.id)
        return p && sz ? { l: p.x, t: p.y, r: p.x + sz.w, b: p.y + sz.h } : null
      })
      .filter(
        (b): b is { l: number; t: number; r: number; b: number } => b !== null,
      )
    if (!boxes.length) continue
    let total = 0
    for (let i = 1; i < pts.length; i++)
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    const cands: { x: number; y: number; score: number }[] = []
    let acc = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const steps = Math.max(1, Math.floor(len / 20))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const at = acc + len * t
        // ignore the first/last 12% so labels never hug the handles
        if (at < total * 0.12 || at > total * 0.88) continue
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        const clear = Math.min(...boxes.map((bx) => distToBox(p, bx)))
        cands.push({ ...p, score: clear - Math.abs(at / total - 0.5) * 40 })
      }
      acc += len
    }
    cands.sort((a, b) => b.score - a.score)
    if (cands.length) candsByEdge.push({ eid, cands: cands.slice(0, 12) })
  }
  // most constrained edges (fewest options / shortest belts) place first,
  // later edges pick their best spot that keeps clear of taken positions
  const taken: { x: number; y: number }[] = []
  const clashes = (p: { x: number; y: number }) =>
    taken.some((q) => Math.abs(q.x - p.x) < 100 && Math.abs(q.y - p.y) < 20)
  candsByEdge
    .slice()
    .sort((a, b) => a.cands.length - b.cands.length)
    .forEach(({ eid, cands }) => {
      const pick = cands.find((c) => !clashes(c)) ?? cands[0]
      labelPos.set(eid, pick)
      taken.push(pick)
    })

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
      type: 'routed',
      label,
      data: {
        waypoints: waypoints.get(e.id),
        stroke: info.hex,
        labelPos: labelPos.get(e.id),
      },
    }
  })

  return { nodes, edges }
}
