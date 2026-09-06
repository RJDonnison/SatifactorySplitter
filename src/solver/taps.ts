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
export function coinDecomp(t: number): number[] | null {
  if (!Number.isInteger(t) || t < BELT_SPEEDS[0]) return null
  const INF = Number.POSITIVE_INFINITY
  const cnt = new Array<number>(t + 1).fill(INF)
  cnt[0] = 0
  for (let v = BELT_SPEEDS[0]; v <= t; v++) {
    for (const c of BELT_SPEEDS) {
      if (c > v) continue
      if (cnt[v - c] + 1 < cnt[v]) cnt[v] = cnt[v - c] + 1
    }
  }
  if (cnt[t] === INF) return null
  const coins: number[] = []
  let v = t
  while (v > 0) {
    for (let i = BELT_SPEEDS.length - 1; i >= 0; i--) {
      const c = BELT_SPEEDS[i]
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
  /** total shares (2, 3, 4 or 6) */
  d: number
}

export interface TargetDecomp {
  /** full belt-speed taps */
  coins: number[]
  /** optional fractional refinement of one tap */
  piece: PieceSpec | null
  /** rough building cost used to pick between decompositions */
  cost: number
  /** leftover flow the piece split pushes to overflow */
  waste: number
}

const bgcd = (a: number, b: number): number => (b ? bgcd(b, a % b) : a)

/**
 * Decompose a target rate into belt-speed taps plus at most one fractional
 * piece: a tapped belt that is split again (e.g. 150 = 120 tap + half of a
 * 60 tap). Exact coin-only decompositions are preferred; otherwise the
 * cheapest piece (fewest buildings, least waste) wins.
 */
export function decomposeTarget(t: number): TargetDecomp | null {
  if (!Number.isInteger(t) || t <= 0) return null
  const exact = coinDecomp(t)
  if (exact) return { coins: exact, piece: null, cost: exact.length, waste: 0 }
  let best: TargetDecomp | null = null
  for (const c of BELT_SPEEDS) {
    for (const d of [2, 3, 4, 6]) {
      for (let k = 1; k < d; k++) {
        if (bgcd(k, d) !== 1) continue // reducible form
        const v = (c * k) / d
        if (!Number.isInteger(v) || v > t) continue
        const rest = t - v
        const coins = rest === 0 ? [] : coinDecomp(rest)
        if (coins === null) continue
        const splitCost = d <= 3 ? 1 : 2
        const mergeCost = Math.ceil((k - 1) / 2)
        const cand: TargetDecomp = {
          coins,
          piece: { c, k, d },
          cost: coins.length + 1 + splitCost + mergeCost,
          waste: c - v,
        }
        if (
          !best ||
          cand.cost < best.cost ||
          (cand.cost === best.cost && cand.waste < best.waste)
        )
          best = cand
      }
    }
  }
  return best
}

export type TapStep =
  | { type: 'tap2'; c: number; gid: number; piece?: PieceSpec }
  | {
      type: 'tap3'
      c1: number
      g1: number
      piece1?: PieceSpec
      c2: number
      g2: number
      piece2?: PieceSpec
    }

export interface TapPlan {
  steps: TapStep[]
  remainder: Frac
}

/**
 * Plan a chain of taps peeling belt-speed amounts off the trunk, largest
 * coins first. A 3-port splitter may carry two taps at once (cheaper than
 * two chained 2-port taps). If a coin cannot satisfy the validity rule the
 * whole group falls back to the (split-solved) tail and planning restarts.
 */
export function planTapChain(
  Rf: Frac,
  decompByGid: (TargetDecomp | null)[],
  allowPair: boolean,
): TapPlan | null {
  const eligible = decompByGid
    .map((d, gid) => (d ? { gid, d } : null))
    .filter((x): x is { gid: number; d: TargetDecomp } => x !== null)
  const dropped = new Set<number>()
  for (;;) {
    const active = eligible.filter((e) => !dropped.has(e.gid))
    if (active.length === 0) return null
    const maxC = (d: TargetDecomp) =>
      Math.max(0, ...d.coins, d.piece ? d.piece.c : 0)
    const order = [...active].sort(
      (a, b) =>
        maxC(b.d) - maxC(a.d) ||
        b.d.coins.length +
          (b.d.piece ? 1 : 0) -
          (a.d.coins.length + (a.d.piece ? 1 : 0)) ||
        a.gid - b.gid,
    )
    const pending: { c: number; gid: number; piece: PieceSpec | null }[] = []
    for (const e of order) {
      const entries = [
        ...e.d.coins.map((c) => ({
          c,
          gid: e.gid,
          piece: null as PieceSpec | null,
        })),
        ...(e.d.piece
          ? [{ c: e.d.piece.c, gid: e.gid, piece: { ...e.d.piece } }]
          : []),
      ].sort((x, y) => y.c - x.c)
      pending.push(...entries)
    }
    const steps: TapStep[] = []
    let f = Rf
    let failGid: number | null = null
    let i = 0
    while (i < pending.length) {
      if (allowPair && i + 1 < pending.length) {
        const a = pending[i]
        const b = pending[i + 1]
        const share3 = F.div(f, frac(3))
        if (F.cmp(frac(a.c), share3) <= 0 && F.cmp(frac(b.c), share3) <= 0) {
          steps.push({
            type: 'tap3',
            c1: a.c,
            g1: a.gid,
            piece1: a.piece ?? undefined,
            c2: b.c,
            g2: b.gid,
            piece2: b.piece ?? undefined,
          })
          f = F.sub(f, frac(a.c + b.c))
          i += 2
          continue
        }
      }
      const a = pending[i]
      const share2 = F.div(f, frac(2))
      if (F.cmp(frac(a.c), share2) <= 0) {
        steps.push({
          type: 'tap2',
          c: a.c,
          gid: a.gid,
          piece: a.piece ?? undefined,
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
  /** A tapped belt feeding a small uniform split tree: k of d shares go to
   * the target, the rest drains to overflow. */
  const growPiece = (tap: BeltEnd, piece: PieceSpec, gid: number) => {
    let leafIdx = 0
    const grow = (end: BeltEnd, d: number) => {
      if (d === 1) {
        pushLeaf(leafIdx < piece.k ? gid : ovfGid, end)
        leafIdx++
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
    grow(tap, piece.d)
  }
  const emitTap = (
    gid: number,
    node: string,
    port: number,
    c: number,
    mk: number,
    piece: PieceSpec | undefined,
  ) => {
    const end: BeltEnd = { node, port, rate: frac(c), tapMk: mk }
    if (piece) growPiece(end, piece, gid)
    else pushLeaf(gid, end)
  }
  let cur = entry
  for (const st of steps) {
    if (st.type === 'tap2') {
      const mk = mkForSpeed(st.c)
      const sid = b.splitter([{ limited: true, mk }, { limited: false }])
      b.connect(cur.node, cur.port, sid, 0, cur.rate)
      emitTap(st.gid, sid, 0, st.c, mk, st.piece)
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
      emitTap(st.g1, sid, 0, st.c1, mk1, st.piece1)
      emitTap(st.g2, sid, 1, st.c2, mk2, st.piece2)
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
