import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs'
import type { Edge, Node } from '@xyflow/react'
import { formatFrac } from '../solver/frac'
import type { NetEdge, NetNode, Solution } from '../solver/types'
import { BELT_HEX } from './belts'
import { orthogonalRoute, type Pt } from './ortho'

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

  const kindOf = new Map(sol.nodes.map((n) => [n.id, n.kind]))
  // how many belts actually enter each merger / leave each splitter — slots
  // are spread evenly over the used ports only (2 merger inputs sit at 1/3
  // and 2/3 of the height, not bunched into the 3-slot grid)
  const mergerIns = new Map<string, number>()
  const splitterOuts = new Map<string, number>()
  for (const e of sol.edges) {
    if (kindOf.get(e.dst) === 'merger')
      mergerIns.set(e.dst, (mergerIns.get(e.dst) ?? 0) + 1)
    if (kindOf.get(e.src) === 'splitter')
      splitterOuts.set(e.src, (splitterOuts.get(e.src) ?? 0) + 1)
  }

  let rankPos = pos1
  const yOf = (id: string) => (rankPos.get(id) ?? { x: 0, y: 0 }).y
  const heightOf = (id: string) => SIZES[kindOf.get(id) ?? 'sink'].h

  // y of the handle a belt lands on (merger input slot, else node centre) —
  // ordering by handle height instead of node height avoids one-slot swaps
  const dstHandleY = (e: NetEdge, inR: Map<string, number>) => {
    if (kindOf.get(e.dst) === 'merger') {
      const m = mergerIns.get(e.dst) ?? 3
      const r = inR.get(`${e.dst}:${e.dstPort}`)
      if (r !== undefined)
        return yOf(e.dst) + ((r + 1) / (m + 1)) * heightOf(e.dst)
    }
    return yOf(e.dst) + heightOf(e.dst) / 2
  }
  // y of the handle a belt leaves from (splitter output slot, else centre)
  const srcHandleY = (e: NetEdge, outR: Map<string, number>) => {
    if (kindOf.get(e.src) === 'splitter') {
      const cnt = splitterOuts.get(e.src) ?? 2
      const r = outR.get(`${e.src}:${e.srcPort}`)
      if (r !== undefined)
        return yOf(e.src) + ((r + 1) / (cnt + 1)) * heightOf(e.src)
    }
    return yOf(e.src) + heightOf(e.src) / 2
  }

  const outTop = new Map<string, string>()
  const outRank = new Map<string, number>()
  const inTop = new Map<string, string>()
  const inRank = new Map<string, number>()
  const fillRanks = () => {
    // keep the previous splitter slots so merger inputs can order by the
    // exact handle each belt leaves from (node centres on the first pass)
    const prevOutRank = new Map(outRank)
    outTop.clear()
    outRank.clear()
    inTop.clear()
    inRank.clear()
    // merger inputs first (splitter outputs below order by where they land)
    for (const n of sol.nodes) {
      if (n.kind !== 'merger') continue
      const ins = sol.edges
        .filter((e) => e.dst === n.id)
        .sort(
          (a, b) =>
            srcHandleY(a, prevOutRank) - srcHandleY(b, prevOutRank) ||
            a.srcPort - b.srcPort ||
            a.dstPort - b.dstPort,
        )
      ins.forEach((e, rank) => {
        inTop.set(
          `${e.dst}:${e.dstPort}`,
          `${(((rank + 1) / (ins.length + 1)) * 100).toFixed(2)}%`,
        )
        inRank.set(`${e.dst}:${e.dstPort}`, rank)
      })
    }
    for (const n of sol.nodes) {
      if (n.kind !== 'splitter') continue
      const outs = sol.edges
        .filter((e) => e.src === n.id)
        .sort(
          (a, b) =>
            dstHandleY(a, inRank) - dstHandleY(b, inRank) ||
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
  }
  fillRanks()

  // pass 2: re-layout with FIXED_POS ports at the ranked handle slots, so the
  // layout engine sees the real anchor points and can order nodes to keep
  // long belts clear of intermediate splitters and mergers
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
        const m = mergerIns.get(n.id) ?? 3
        for (let p = 0; p < m; p++) {
          const rank = inRank.get(`${n.id}:${p}`) ?? p
          ports.push(portRef(`${n.id}__p${p}`, 0, ((rank + 1) / (m + 1)) * s.h))
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

  // re-anchor every route to the exact handle positions implied by the final
  // layout and slot ranks, and make it strictly orthogonal — BEFORE bending
  // segments around node boxes, so the detour pass sees the final geometry
  const handlePoint = (e: NetEdge, side: 'src' | 'dst') => {
    const id = side === 'src' ? e.src : e.dst
    const p = pos.get(id)
    const kind = kindOf.get(id)
    const s = SIZES[kind ?? 'sink']
    if (!p) return null
    if (side === 'src') {
      if (kind === 'splitter') {
        const r = outRank.get(`${id}:${e.srcPort}`)
        const cnt = splitterOuts.get(id) ?? 2
        if (r !== undefined)
          return { x: p.x + s.w, y: p.y + ((r + 1) / (cnt + 1)) * s.h }
      }
      return { x: p.x + s.w, y: p.y + s.h / 2 }
    }
    if (kind === 'merger') {
      const m = mergerIns.get(id) ?? 3
      const r = inRank.get(`${id}:${e.dstPort}`)
      if (r !== undefined) return { x: p.x, y: p.y + ((r + 1) / (m + 1)) * s.h }
    }
    return { x: p.x, y: p.y + s.h / 2 }
  }
  for (const e of sol.edges) {
    const pts = waypoints.get(e.id)
    if (!pts || pts.length < 2) continue
    const src = handlePoint(e, 'src')
    const dst = handlePoint(e, 'dst')
    if (!src || !dst) continue
    waypoints.set(e.id, orthogonalRoute(pts, src, dst))
  }

  // ELK's orthogonal routes can still cut through an intermediate node box;
  // bend any offending segment around that box with a clearance detour,
  // keeping the node placement itself untouched
  const CLEAR = 16
  const edgeById = new Map(sol.edges.map((e) => [e.id, e]))
  const sizeOf = new Map(sol.nodes.map((n) => [n.id, SIZES[n.kind]]))
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

  // belts that run between the same pair of nodes form a bundle; ELK gives
  // each belt its own corridor and nested corridors make even a monotone fan
  // cross itself — rebuild each bundle as a tidy fan with non-crossing
  // corridors, falling back to the routed path whenever the fan would hit
  // a node box
  const boxOf = (id: string) => {
    const p = pos.get(id)
    const s = SIZES[kindOf.get(id) ?? 'sink']
    return p
      ? { id, l: p.x, t: p.y, r: p.x + s.w, b: p.y + s.h }
      : { id, l: 0, t: 0, r: 0, b: 0 }
  }
  const allBoxes = sol.nodes.map((n) => boxOf(n.id))
  const segCrossBox = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    bx: { l: number; t: number; r: number; b: number },
  ) =>
    Math.max(a.x, b.x) > bx.l &&
    Math.min(a.x, b.x) < bx.r &&
    Math.max(a.y, b.y) > bx.t &&
    Math.min(a.y, b.y) < bx.b
  const segsCross = (
    a1: { x: number; y: number },
    a2: { x: number; y: number },
    b1: { x: number; y: number },
    b2: { x: number; y: number },
  ) => {
    const cr = (o: Pt, p: Pt, q: Pt) =>
      (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
    const d1 = cr(a1, a2, b1)
    const d2 = cr(a1, a2, b2)
    const d3 = cr(b1, b2, a1)
    const d4 = cr(b1, b2, a2)
    return (
      d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 && Math.abs(d1) + Math.abs(d2) > 1
    )
  }
  const routesCross = (
    r1: { x: number; y: number }[],
    r2: { x: number; y: number }[],
  ) => {
    for (let i = 1; i < r1.length; i++)
      for (let j = 1; j < r2.length; j++)
        if (segsCross(r1[i - 1], r1[i], r2[j - 1], r2[j])) return true
    return false
  }
  const bundles = new Map<string, NetEdge[]>()
  for (const e of sol.edges) {
    // group every belt entering the same merger — ELK gives each its own
    // corridor and lane swaps make belts cross or run on top of each other
    if (kindOf.get(e.dst) !== 'merger') continue
    const list = bundles.get(e.dst) ?? []
    list.push(e)
    bundles.set(e.dst, list)
  }
  for (const [dstId, group] of bundles) {
    if (group.length < 2) continue
    const dstBox = boxOf(dstId)
    const ends = group.map((e) => {
      const pts = waypoints.get(e.id)
      return { exit: pts?.[0], entry: pts?.[pts.length - 1] }
    })
    if (ends.some((x) => !x.exit || !x.entry)) continue
    // corridors live in the gap past the furthest exit, before the merger
    const gapL = Math.max(...ends.map((x) => x.exit!.x)) + 20
    const gapR = dstBox.l - 20
    const n = group.length
    if (gapR - gapL < n * 28 + 24) continue // no room for a fan — keep routed paths
    const buildFan = (perm: number[]) => {
      const routes = group.map((_, i) => {
        const xc = gapL + ((perm[i] + 1) * (gapR - gapL)) / (n + 1)
        const a = ends[i].exit!
        const b = ends[i].entry!
        return a.y === b.y
          ? [a, b]
          : [a, { x: xc, y: a.y }, { x: xc, y: b.y }, b]
      })
      for (let i = 0; i < routes.length; i++)
        for (let j = i + 1; j < routes.length; j++)
          if (routesCross(routes[i], routes[j])) return null
      for (const route of routes)
        for (let s = 1; s < route.length; s++)
          for (const bx of allBoxes)
            if (
              bx.id !== dstId &&
              !group.some((g) => bx.id === g.src) &&
              segCrossBox(route[s - 1], route[s], bx)
            )
              return null
      return routes
    }
    const perms: number[][] = [[]]
    for (let i = 0; i < n; i++) {
      const next: number[][] = []
      for (const p of perms)
        for (let k = 0; k <= p.length; k++)
          next.push([...p.slice(0, k), i, ...p.slice(k)])
      perms.length = 0
      perms.push(...next)
    }
    let fan: { x: number; y: number }[][] | null = null
    for (const perm of perms) {
      fan = buildFan(perm)
      if (fan) break
    }
    if (fan) group.forEach((e, i) => waypoints.set(e.id, fan![i]))
  }

  // belts ELK lane-swapped into the same vertical corridor run on top of
  // each other — an overlapping pair reads as one line and hides a crossing;
  // nudge one belt sideways with a small orthogonal jog
  const vRuns = (pts: Pt[]) => {
    const out: { x: number; y0: number; y1: number }[] = []
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 6)
        out.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) })
    }
    return out
  }
  const runsCoincide = (
    ra: { x: number; y0: number; y1: number },
    rb: { x: number; y0: number; y1: number },
  ) =>
    Math.abs(ra.x - rb.x) < 6 &&
    Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0) > 6
  for (let i = 0; i < sol.edges.length; i++) {
    for (let j = i + 1; j < sol.edges.length; j++) {
      const eb = sol.edges[j]
      const A = waypoints.get(sol.edges[i].id)
      const B = waypoints.get(eb.id)
      if (!A || !B || A.length < 2 || B.length < 2) continue
      const runsA = vRuns(A)
      if (!runsA.some((ra) => vRuns(B).some((rb) => runsCoincide(ra, rb))))
        continue
      const next = B.map((p) => ({ ...p }))
      let moved = false
      for (let k = 1; k < next.length; k++) {
        const a = next[k - 1]
        const b = next[k]
        if (Math.abs(a.x - b.x) >= 0.5 || Math.abs(a.y - b.y) <= 6) continue
        const run = {
          x: a.x,
          y0: Math.min(a.y, b.y),
          y1: Math.max(a.y, b.y),
        }
        if (!runsA.some((ra) => runsCoincide(ra, run))) continue
        let x: number | null = null
        for (const off of [16, -16, 32, -32]) {
          const cand = a.x + off
          const segs: [Pt, Pt][] = [
            [a, { x: cand, y: a.y }],
            [
              { x: cand, y: a.y },
              { x: cand, y: b.y },
            ],
            [{ x: cand, y: b.y }, b],
          ]
          if (
            segs.every(([s0, s1]) =>
              allBoxes.every(
                (bx) =>
                  bx.id === eb.src ||
                  bx.id === eb.dst ||
                  !segCrossBox(s0, s1, bx),
              ),
            )
          ) {
            x = cand
            break
          }
        }
        if (x !== null) {
          next.splice(k, 1, { x, y: a.y }, { x, y: b.y })
          k++
          moved = true
        }
      }
      if (moved) waypoints.set(eb.id, next)
    }
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
      case 'merger': {
        const m = mergerIns.get(n.id) ?? 3
        return {
          ...base,
          type: 'merger',
          data: {
            inputTops: Array.from(
              { length: m },
              (_, p) =>
                inTop.get(`${n.id}:${p}`) ??
                `${(((p + 1) / (m + 1)) * 100).toFixed(2)}%`,
            ),
          },
        }
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
