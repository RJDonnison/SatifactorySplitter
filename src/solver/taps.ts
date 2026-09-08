import { F, frac, type Frac } from './frac'
import { BELT_SPEEDS } from './gameData'
import { NetBuilder, type BeltEnd } from './net'

/**
 * Belt taps (flow limiters): a splitter output fed onto a lower-tier belt
 * delivers exactly that belt's throughput once saturated; the surplus backs
 * up and redistributes to the remaining ports.
 *
 * Validity rule (saturation guarantee): a tap of capacity c on a splitter
 * with p connected ports fed by flow f requires c <= f / p.
 */

/** Minimum-count coin change over belt speeds; descending coins, or null. */
export function coinDecomp(t: number, maxMk = 6): number[] | null {
  const speeds = BELT_SPEEDS.filter((_, i) => i < maxMk)
  if (!Number.isInteger(t) || t < speeds[0]) return null
  const INF = Number.POSITIVE_INFINITY
  const cnt = new Array<number>(t + 1).fill(INF)
  cnt[0] = 0
  for (let v = speeds[0]; v <= t; v++) {
    for (const c of speeds) {
      if (c > v) continue
      if (cnt[v - c] + 1 < cnt[v]) cnt[v] = cnt[v - c] + 1
    }
  }
  if (cnt[t] === INF) return null
  const coins: number[] = []
  let v = t
  while (v > 0) {
    for (let i = speeds.length - 1; i >= 0; i--) {
      const c = speeds[i]
      if (c <= v && cnt[v - c] === cnt[v] - 1) {
        coins.push(c)
        v -= c
        break
      }
    }
  }
  return coins
}

export function mkForSpeed(speed: number): number {
  const mk = (BELT_SPEEDS as readonly number[]).indexOf(speed) + 1
  if (mk === 0) throw new Error(`not a belt speed: ${speed}`)
  return mk
}

/** A tapped belt split further: k of d equal shares feed the target. */
export interface PieceSpec {
  /** tapped belt speed */
  c: number
  /** shares taken for the target */
  k: number
  /** total shares (a 2^a * 3^b count) */
  d: number
}

export interface TargetDecomp {
  /** full belt-speed taps */
  coins: number[]
  /** fractional refinements: tapped belts that are split again */
  pieces: PieceSpec[]
  /** rough building cost used to pick between decompositions */
  cost: number
  /** leftover flow the piece splits push to overflow */
  waste: number
}

const bgcd = (a: number, b: number): number => (b ? bgcd(b, a % b) : a)

/** split-tree sizes a tapped belt may be divided into (2^a * 3^b leaves) */
const PIECE_DIVS = [
  2, 3, 4, 6, 8, 9, 12, 16, 18, 24, 27, 32, 36, 48, 54, 64, 72, 81,
]

/** splitters needed for a uniform d-leaf split tree */
const splitCost = (d: number): number =>
  d === 1 ? 0 : 1 + splitCost(d % 3 === 0 ? d / 3 : d / 2)

interface Part {
  /** amount this part contributes to the target */
  v: number
  cost: number
  waste: number
  coin?: number
  piece?: PieceSpec
}

function partUniverse(maxMk: number): Part[] {
  const speeds = BELT_SPEEDS.filter((_, i) => i < maxMk)
  const parts: Part[] = speeds.map((c) => ({
    v: c,
    cost: 1,
    waste: 0,
    coin: c,
  }))
  for (const c of speeds) {
    for (const d of PIECE_DIVS) {
      for (let k = 1; k < d; k++) {
        if (bgcd(k, d) !== 1) continue // reducible form
        const v = (c * k) / d
        if (!Number.isInteger(v)) continue
        parts.push({
          v,
          cost: 1 + splitCost(d) + Math.ceil((k - 1) / 2),
          waste: c - v,
          piece: { c, k, d },
        })
      }
    }
  }
  return parts
}

/**
 * Decompose a target rate into belt-speed taps plus any number of fractional
 * pieces (tapped belts that are split again, e.g. 150 = 120 tap + half of a
 * 60 tap, or 50 = half of a 60 tap + a third of a 60 tap). A small DP finds
 * the cheapest decomposition; leftover piece flow drains to overflow.
 */
export function decomposeTarget(t: number, maxMk = 6): TargetDecomp | null {
  if (!Number.isInteger(t) || t <= 0) return null
  const parts = partUniverse(maxMk)
  interface Node {
    cost: number
    waste: number
    n: number
    prev: number
    part: Part | null
  }
  const dp: (Node | null)[] = new Array(t + 1).fill(null)
  dp[0] = { cost: 0, waste: 0, n: 0, prev: -1, part: null }
  const better = (a: Node | null, b: Node) =>
    !a ||
    b.cost < a.cost ||
    (b.cost === a.cost &&
      (b.waste < a.waste || (b.waste === a.waste && b.n < a.n)))
  for (let a = 1; a <= t; a++) {
    let best: Node | null = null
    for (const p of parts) {
      if (p.v > a) continue
      const prev = dp[a - p.v]
      if (!prev || prev.n >= 5) continue // keep chains buildable
      const cand: Node = {
        cost: prev.cost + p.cost,
        waste: prev.waste + p.waste,
        n: prev.n + 1,
        prev: a - p.v,
        part: p,
      }
      if (better(best, cand)) best = cand
    }
    dp[a] = best
  }
  const end = dp[t]
  if (!end) return null
  const coins: number[] = []
  const pieces: PieceSpec[] = []
  let partsUsed = 0
  let cur = end
  while (cur.part) {
    partsUsed++
    if (cur.part.coin !== undefined) coins.push(cur.part.coin)
    if (cur.part.piece) pieces.push(cur.part.piece)
    cur = dp[cur.prev]!
  }
  return {
    coins,
    pieces,
    cost: end.cost + Math.ceil((partsUsed - 1) / 2),
    waste: end.waste,
  }
}

/** one share of a shared tapped-and-split belt */
export interface SharedShare {
  gid: number
  k: number
}

/** a tapped belt split once for several targets: kᵢ of d leaves per target */
export interface SharedPiece {
  c: number
  d: number
  shares: SharedShare[]
}

export type TapStep =
  | { type: 'tap2'; c: number; gid: number; shared?: SharedPiece }
  | {
      type: 'tap3'
      c1: number
      g1: number
      shared1?: SharedPiece
      c2: number
      g2: number
      shared2?: SharedPiece
    }

export interface TapPlan {
  steps: TapStep[]
  remainder: Frac
}

/**
 * Plan a chain of taps peeling belt-speed amounts off the trunk, largest
 * coins first. A 3-port splitter may carry two taps at once (cheaper than
 * two chained 2-port taps). Groups in `defer` are left to the tail instead
 * of being tapped (a target equal to the remainder flow needs no tap at
 * all). If a coin cannot satisfy the validity rule the whole group falls
 * back to the (split-solved) tail and planning restarts.
 */
export function planTapChain(
  Rf: Frac,
  decompByGid: (TargetDecomp | null)[],
  allowPair: boolean,
  defer: ReadonlySet<number> = new Set(),
): TapPlan | null {
  const eligible = decompByGid
    .map((d, gid) => (d !== null && !defer.has(gid) ? { gid, d } : null))
    .filter((x): x is { gid: number; d: TargetDecomp } => x !== null)
  const dropped = new Set<number>()
  for (;;) {
    const active = eligible.filter((e) => !dropped.has(e.gid))
    if (active.length === 0) return null
    const maxC = (d: TargetDecomp) =>
      Math.max(0, ...d.coins, ...d.pieces.map((p) => p.c))
    const order = [...active].sort(
      (a, b) =>
        maxC(b.d) - maxC(a.d) ||
        b.d.coins.length +
          b.d.pieces.length -
          (a.d.coins.length + a.d.pieces.length) ||
        a.gid - b.gid,
    )
    interface Entry {
      c: number
      gid: number
      piece: PieceSpec | null
      shared?: SharedPiece
    }
    const pending: Entry[] = []
    for (const e of order) {
      const entries: Entry[] = [
        ...e.d.coins.map((c) => ({
          c,
          gid: e.gid,
          piece: null as PieceSpec | null,
        })),
        ...e.d.pieces.map((p) => ({ c: p.c, gid: e.gid, piece: { ...p } })),
      ].sort((x, y) => y.c - x.c)
      pending.push(...entries)
    }
    // sharing pass: pieces tapping the same belt speed with the same split
    // count can share ONE tap and ONE split tree when their shares fit
    // (e.g. 30 for output A and 30 for output B = one 60 tap split 2-way)
    const consumed = new Set<number>()
    {
      const byKey = new Map<string, number[]>()
      pending.forEach((entry, idx) => {
        if (!entry.piece) return
        const key = `${entry.piece.c}:${entry.piece.d}`
        const arr = byKey.get(key) ?? []
        arr.push(idx)
        byKey.set(key, arr)
      })
      for (const idxs of byKey.values()) {
        let chunk: { gid: number; k: number; rep: number }[] = []
        let used = 0
        const flush = () => {
          if (!chunk.length) return
          const shares = chunk
            .slice()
            .sort((x, y) => y.k - x.k)
            .map(({ gid, k }) => ({ gid, k }))
          const rep = chunk[0].rep
          pending[rep] = {
            c: pending[rep].piece!.c,
            gid: shares[0].gid,
            piece: null,
            shared: {
              c: pending[rep].piece!.c,
              d: pending[rep].piece!.d,
              shares,
            },
          }
          for (const m of chunk) if (m.rep !== rep) consumed.add(m.rep)
          chunk = []
          used = 0
        }
        for (const idx of idxs) {
          const piece = pending[idx].piece!
          if (used + piece.k > piece.d) flush()
          chunk.push({ gid: pending[idx].gid, k: piece.k, rep: idx })
          used += piece.k
        }
        flush()
      }
    }
    const live = pending.filter((_, idx) => !consumed.has(idx))
    const steps: TapStep[] = []
    let f = Rf
    let failGid: number | null = null
    let i = 0
    while (i < live.length) {
      if (allowPair && i + 1 < live.length) {
        const a = live[i]
        const b = live[i + 1]
        const share3 = F.div(f, frac(3))
        if (F.cmp(frac(a.c), share3) <= 0 && F.cmp(frac(b.c), share3) <= 0) {
          steps.push({
            type: 'tap3',
            c1: a.c,
            g1: a.gid,
            shared1: a.shared,
            c2: b.c,
            g2: b.gid,
            shared2: b.shared,
          })
          f = F.sub(f, frac(a.c + b.c))
          i += 2
          continue
        }
      }
      const a = live[i]
      const share2 = F.div(f, frac(2))
      if (F.cmp(frac(a.c), share2) <= 0) {
        steps.push({
          type: 'tap2',
          c: a.c,
          gid: a.gid,
          shared: a.shared,
        })
        f = F.sub(f, frac(a.c))
        i++
      } else {
        failGid = a.gid
        break
      }
    }
    if (failGid === null) return { steps, remainder: f }
    dropped.add(failGid)
  }
}

export function buildTapChain(
  b: NetBuilder,
  steps: TapStep[],
  entry: BeltEnd,
  leafPorts: Map<number, BeltEnd[]>,
  ovfGid: number,
): BeltEnd {
  const pushLeaf = (gid: number, end: BeltEnd) => {
    const list = leafPorts.get(gid) ?? []
    list.push(end)
    leafPorts.set(gid, list)
  }
  /** A tapped belt feeding a small uniform split tree: kᵢ of d leaves go to
   * each sharing target (possibly several), the rest drains to overflow. */
  const growShared = (tap: BeltEnd, sp: SharedPiece) => {
    const assign: number[] = []
    for (const s of sp.shares) for (let j = 0; j < s.k; j++) assign.push(s.gid)
    let leafIdx = 0
    const grow = (end: BeltEnd, d: number) => {
      if (d === 1) {
        pushLeaf(assign[leafIdx] ?? ovfGid, end)
        leafIdx++
        return
      }
      // a subtree whose leaves all drain to overflow stays on one belt
      let allOvf = true
      for (let j = leafIdx; j < leafIdx + d; j++) {
        if (assign[j] !== undefined) {
          allOvf = false
          break
        }
      }
      if (allOvf) {
        pushLeaf(ovfGid, end)
        leafIdx += d
        return
      }
      const p = d % 3 === 0 ? 3 : 2
      const sid = b.splitter(
        Array.from({ length: p }, () => ({ limited: false as const })),
      )
      b.connect(end.node, end.port, sid, 0, end.rate, end.tapMk)
      for (let i = 0; i < p; i++)
        grow(
          { node: sid, port: i, rate: F.div(end.rate, frac(p)), tapMk: null },
          d / p,
        )
    }
    grow(tap, sp.d)
  }
  const emitTap = (
    gid: number,
    node: string,
    port: number,
    c: number,
    mk: number,
    shared: SharedPiece | undefined,
  ) => {
    const end: BeltEnd = { node, port, rate: frac(c), tapMk: mk }
    if (shared) growShared(end, shared)
    else pushLeaf(gid, end)
  }
  let cur = entry
  for (const st of steps) {
    if (st.type === 'tap2') {
      const mk = mkForSpeed(st.c)
      const sid = b.splitter([{ limited: true, mk }, { limited: false }])
      b.connect(cur.node, cur.port, sid, 0, cur.rate)
      emitTap(st.gid, sid, 0, st.c, mk, st.shared)
      cur = {
        node: sid,
        port: 1,
        rate: F.sub(cur.rate, frac(st.c)),
        tapMk: null,
      }
    } else {
      const mk1 = mkForSpeed(st.c1)
      const mk2 = mkForSpeed(st.c2)
      const sid = b.splitter([
        { limited: true, mk: mk1 },
        { limited: true, mk: mk2 },
        { limited: false },
      ])
      b.connect(cur.node, cur.port, sid, 0, cur.rate)
      emitTap(st.g1, sid, 0, st.c1, mk1, st.shared1)
      emitTap(st.g2, sid, 1, st.c2, mk2, st.shared2)
      cur = {
        node: sid,
        port: 2,
        rate: F.sub(cur.rate, frac(st.c1 + st.c2)),
        tapMk: null,
      }
    }
  }
  return cur
}
