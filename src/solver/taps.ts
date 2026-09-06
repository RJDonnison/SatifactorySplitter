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

export type TapStep =
  | { type: 'tap2'; c: number; gid: number }
  | { type: 'tap3'; c1: number; g1: number; c2: number; g2: number }

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
  coinsByGid: (number[] | null)[],
  allowPair: boolean,
): TapPlan | null {
  const eligible = coinsByGid
    .map((coins, gid) => (coins ? { gid, coins } : null))
    .filter((x): x is { gid: number; coins: number[] } => x !== null)
  const dropped = new Set<number>()
  for (;;) {
    const active = eligible.filter((e) => !dropped.has(e.gid))
    if (active.length === 0) return null
    const order = [...active].sort(
      (a, b) =>
        b.coins[0] - a.coins[0] ||
        b.coins.length - a.coins.length ||
        a.gid - b.gid,
    )
    const pending: { c: number; gid: number }[] = []
    for (const e of order)
      for (const c of e.coins) pending.push({ c, gid: e.gid })
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
          steps.push({ type: 'tap3', c1: a.c, g1: a.gid, c2: b.c, g2: b.gid })
          f = F.sub(f, frac(a.c + b.c))
          i += 2
          continue
        }
      }
      const a = pending[i]
      const share2 = F.div(f, frac(2))
      if (F.cmp(frac(a.c), share2) <= 0) {
        steps.push({ type: 'tap2', c: a.c, gid: a.gid })
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
): BeltEnd {
  const pushLeaf = (gid: number, end: BeltEnd) => {
    const list = leafPorts.get(gid) ?? []
    list.push(end)
    leafPorts.set(gid, list)
  }
  let cur = entry
  for (const st of steps) {
    if (st.type === 'tap2') {
      const mk = mkForSpeed(st.c)
      const sid = b.splitter([{ limited: true, mk }, { limited: false }])
      b.connect(cur.node, cur.port, sid, 0, cur.rate)
      pushLeaf(st.gid, { node: sid, port: 0, rate: frac(st.c), tapMk: mk })
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
      pushLeaf(st.g1, { node: sid, port: 0, rate: frac(st.c1), tapMk: mk1 })
      pushLeaf(st.g2, { node: sid, port: 1, rate: frac(st.c2), tapMk: mk2 })
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
