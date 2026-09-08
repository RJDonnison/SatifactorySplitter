import type { Problem } from './store'
import { inPorts, outPorts, type DocNode, type NetDoc } from './doc'

interface Packed {
  i: number[]
  o: number[]
  t: number
  m?: number
  /** manual-mode layout: packed doc + implicit "editing" mode */
  n?: { nd: unknown[]; ed: unknown[] }
}

const toB64Url = (s: string): string =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64Url = (s: string): string =>
  atob(s.replace(/-/g, '+').replace(/_/g, '/'))

const MAX_NODES = 200
const MAX_EDGES = 500

export function encodeProblem(p: Problem): string {
  const packed: Packed = {
    i: p.inputs.map((b) => b.rate),
    o: p.outputs.map((b) => b.rate),
    t: p.tolerance,
    m: p.maxMk,
  }
  return toB64Url(JSON.stringify(packed))
}

/** pack a manual doc: nodes as [kind,x,y,extra] rows, edges as endpoint indices */
export function encodeDoc(d: NetDoc): Packed['n'] {
  const idx = new Map(d.nodes.map((n, i) => [n.id, i]))
  const nd = d.nodes.map((n) => {
    switch (n.kind) {
      case 'source':
        return [0, r2(n.x), r2(n.y), n.rate]
      case 'sink':
        return [1, r2(n.x), r2(n.y), n.rate, n.label]
      case 'overflow':
        return [2, r2(n.x), r2(n.y)]
      case 'splitter':
        return [3, r2(n.x), r2(n.y), n.ports.map((p) => (p.limited ? p.mk : 0))]
      case 'merger':
        return [4, r2(n.x), r2(n.y)]
    }
  })
  const ed = d.edges
    .filter((e) => idx.has(e.src) && idx.has(e.dst))
    .map((e) => [
      idx.get(e.src)!,
      e.srcPort,
      idx.get(e.dst)!,
      e.dstPort,
      e.mk ?? 0,
    ])
  return { nd, ed }
}
const r2 = (v: number) => Math.round(v * 100) / 100

const isFin = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** structurally validate and unpack; returns null on any malformed input */
export function decodeDoc(pack: Packed['n']): NetDoc | null {
  if (!pack || !Array.isArray(pack.nd) || !Array.isArray(pack.ed)) return null
  if (pack.nd.length > MAX_NODES || pack.ed.length > MAX_EDGES) return null
  const nodes: DocNode[] = []
  for (const row of pack.nd) {
    if (!Array.isArray(row)) return null
    const [kind, x, y] = row
    if (!isFin(kind) || !isFin(x) || !isFin(y)) return null
    switch (kind) {
      case 0: {
        const rate = row[3]
        if (!isFin(rate) || rate < 0 || rate > 12000) return null
        nodes.push({ id: '', kind: 'source', rate, x, y })
        break
      }
      case 1: {
        const rate = row[3]
        const label = row[4]
        if (!isFin(rate) || rate < 0 || rate > 12000) return null
        if (label !== undefined && typeof label !== 'string') return null
        nodes.push({
          id: '',
          kind: 'sink',
          label: label ?? 'Output',
          rate,
          x,
          y,
        })
        break
      }
      case 2:
        nodes.push({ id: '', kind: 'overflow', x, y })
        break
      case 3: {
        const ports = row[3]
        if (
          !Array.isArray(ports) ||
          ports.length < 2 ||
          ports.length > 3 ||
          !ports.every((m) => Number.isInteger(m) && m >= 0 && m <= 6)
        )
          return null
        nodes.push({
          id: '',
          kind: 'splitter',
          ports: ports.map((m: number) =>
            m === 0 ? { limited: false } : { limited: true, mk: m },
          ),
          x,
          y,
        })
        break
      }
      case 4:
        nodes.push({ id: '', kind: 'merger', x, y })
        break
      default:
        return null
    }
  }
  nodes.forEach((n, i) => (n.id = `u${i}`))

  const edges: NetDoc['edges'] = []
  const srcClaim = new Set<string>()
  const dstClaim = new Set<string>()
  for (const row of pack.ed) {
    if (!Array.isArray(row) || row.length < 5) return null
    const [si, sp, di, dp, mk] = row
    if (
      !Number.isInteger(si) ||
      !Number.isInteger(sp) ||
      !Number.isInteger(di) ||
      !Number.isInteger(dp) ||
      !Number.isInteger(mk)
    )
      return null
    if (si < 0 || si >= nodes.length || di < 0 || di >= nodes.length)
      return null
    if (mk < 0 || mk > 6) return null
    const s = nodes[si]
    const t = nodes[di]
    if (si === di) return null // self-loop
    if (sp < 0 || sp >= outPorts(s)) return null
    if (dp < 0 || dp >= inPorts(t)) return null
    const sk = `${si}:${sp}`
    const dk = `${di}:${dp}`
    if (srcClaim.has(sk) || dstClaim.has(dk)) return null
    srcClaim.add(sk)
    dstClaim.add(dk)
    edges.push({
      id: `ue${edges.length}`,
      src: s.id,
      srcPort: sp,
      dst: t.id,
      dstPort: dp,
      mk: mk === 0 ? null : mk,
    })
  }
  return { nodes, edges }
}

export function decodeProblem(code: string): Problem | null {
  try {
    const raw = JSON.parse(fromB64Url(code)) as Partial<Packed>
    if (!Array.isArray(raw.i) || !Array.isArray(raw.o)) return null
    const pos = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0
    if (!raw.i.every(pos) || !raw.o.every(pos)) return null
    return {
      inputs: raw.i.map((rate) => ({
        id: `io${rate}-${Math.random()}`,
        rate,
        mk: null,
      })),
      outputs: raw.o.map((rate) => ({
        id: `o${rate}-${Math.random()}`,
        rate,
        mk: null,
      })),
      tolerance:
        typeof raw.t === 'number' && raw.t > 0 && raw.t <= 0.05 ? raw.t : 0.01,
      maxMk:
        typeof raw.m === 'number' && raw.m >= 1 && raw.m <= 6
          ? Math.round(raw.m)
          : 6,
    }
  } catch {
    return null
  }
}

export interface UrlState {
  problem: Problem | null
  /** a `n` section means the link was shared from manual editing */
  manual: boolean
  doc: NetDoc | null
}

export function readStateFromUrl(): UrlState {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('s')
  if (!code) return { problem: null, manual: false, doc: null }
  try {
    const raw = JSON.parse(fromB64Url(code)) as Partial<Packed>
    const problem = decodeProblem(code)
    let doc: NetDoc | null = null
    if (raw.n) {
      doc = decodeDoc(raw.n)
      if (!doc) return { problem, manual: false, doc: null }
    }
    return { problem, manual: doc !== null, doc }
  } catch {
    return { problem: null, manual: false, doc: null }
  }
}

export function writeStateToUrl(
  p: Problem,
  mode: 'auto' | 'manual',
  doc: NetDoc | null,
): void {
  const url = new URL(window.location.href)
  if (mode === 'manual' && doc) {
    const withDoc: Packed = {
      i: p.inputs.map((b) => b.rate),
      o: p.outputs.map((b) => b.rate),
      t: p.tolerance,
      m: p.maxMk,
      n: encodeDoc(doc),
    }
    url.searchParams.set('s', toB64Url(JSON.stringify(withDoc)))
  } else {
    url.searchParams.set('s', encodeProblem(p))
  }
  window.history.replaceState(null, '', url.toString())
}
