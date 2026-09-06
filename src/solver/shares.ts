import { F, frac, type Frac } from './frac'
import { NetBuilder, type BeltEnd } from './net'

/**
 * Pure equal-split synthesis.
 *
 * Every output is expressed as k shares of R/N where N = 2^a * 3^b (the only
 * fractions equal-split trees can produce). A DP builds a splitter tree over
 * the share counts; a subtree whose shares all belong to one group collapses
 * into a direct belt (pruning), and groups fed by several belts get mergers.
 */

export interface ShareGroup {
  gid: number
  k: number
}

export type ShareTree =
  | { type: 'direct'; gid: number; shares: number }
  | { type: 'split'; ports: 2 | 3; shares: number; children: ShareTree[] }

const memo = new Map<string, ShareTree | null>()

export function resetShares() {
  memo.clear()
}

function scoreTree(t: ShareTree): number {
  let splitters = 0
  const belts = new Map<number, number>()
  const walk = (n: ShareTree) => {
    if (n.type === 'direct') belts.set(n.gid, (belts.get(n.gid) ?? 0) + 1)
    else {
      splitters++
      n.children.forEach(walk)
    }
  }
  walk(t)
  let mergers = 0
  belts.forEach((b) => (mergers += Math.ceil((b - 1) / 2)))
  return splitters + mergers
}

/**
 * Split the sorted group stream into p consecutive bins of exactly `part`
 * shares; a group may straddle two bins (its shares are then merged later).
 */
function sliceGroups(
  gs: ShareGroup[],
  p: 2 | 3,
  part: number,
): ShareGroup[][] | null {
  const sorted = [...gs].sort((a, b) => b.k - a.k || a.gid - b.gid)
  const bins: ShareGroup[][] = Array.from({ length: p }, () => [])
  let bi = 0
  let sum = 0
  for (const g0 of sorted) {
    let k = g0.k
    while (k > 0) {
      if (bi >= p) return null
      const take = Math.min(k, part - sum)
      bins[bi].push({ gid: g0.gid, k: take })
      sum += take
      k -= take
      if (sum === part) {
        bi++
        sum = 0
      }
    }
  }
  return bi === p ? bins : null
}

export function bestTree(s: number, gs: ShareGroup[]): ShareTree | null {
  if (gs.length === 1) {
    return gs[0].k === s ? { type: 'direct', gid: gs[0].gid, shares: s } : null
  }
  if (gs.reduce((a, g) => a + g.k, 0) !== s) return null
  const key = `${s}|${gs
    .map((g) => `${g.gid}:${g.k}`)
    .sort()
    .join(',')}`
  const cached = memo.get(key)
  if (cached !== undefined) return cached
  let best: ShareTree | null = null
  let bestScore = Infinity
  for (const p of [3, 2] as const) {
    if (s % p !== 0) continue
    const bins = sliceGroups(gs, p, s / p)
    if (!bins) continue
    const children: ShareTree[] = []
    let ok = true
    for (const bin of bins) {
      const t = bestTree(s / p, bin)
      if (!t) {
        ok = false
        break
      }
      children.push(t)
    }
    if (!ok) continue
    const tree: ShareTree = { type: 'split', ports: p, shares: s, children }
    const sc = scoreTree(tree)
    if (sc < bestScore) {
      best = tree
      bestScore = sc
    }
  }
  memo.set(key, best)
  return best
}

export function buildShareTree(
  b: NetBuilder,
  tree: ShareTree,
  entry: BeltEnd,
  leafPorts: Map<number, BeltEnd[]>,
): void {
  if (tree.type === 'direct') {
    const list = leafPorts.get(tree.gid) ?? []
    list.push(entry)
    leafPorts.set(tree.gid, list)
    return
  }
  const sid = b.splitter(
    Array.from({ length: tree.ports }, () => ({ limited: false as const })),
  )
  b.connect(entry.node, entry.port, sid, 0, entry.rate)
  const childRate = F.div(entry.rate, frac(tree.ports))
  tree.children.forEach((c, i) =>
    buildShareTree(
      b,
      c,
      { node: sid, port: i, rate: childRate, tapMk: null },
      leafPorts,
    ),
  )
}

const MAX_N = 2304

export function nCandidates(): number[] {
  const out: number[] = []
  for (let a = 0; 2 ** a <= MAX_N; a++) {
    for (let b = 0; 2 ** a * 3 ** b <= MAX_N; b++) out.push(2 ** a * 3 ** b)
  }
  return out.sort((x, y) => x - y)
}

/** Smallest N = 2^a*3^b such that every target is an exact multiple of R/N. */
export function chooseExactN(
  Rf: Frac,
  targets: Frac[],
): { N: number; ks: number[] } | null {
  for (const N of nCandidates()) {
    if (N < targets.length) continue
    const ks: number[] = []
    let ok = true
    for (const t of targets) {
      const k = F.div(F.mul(t, frac(N)), Rf)
      if (!F.isInt(k)) {
        ok = false
        break
      }
      ks.push(Number(k.n))
    }
    if (ok) return { N, ks }
  }
  return null
}

export interface SnappedPlan {
  N: number
  ks: number[]
  maxRelErr: number
}

/** Snap non-constructible targets to the nearest k * R/N grid within tolerance. */
export function chooseSnappedN(
  Rf: Frac,
  targets: Frac[],
  tolerance: number,
): SnappedPlan | null {
  const Rn = F.toNumber(Rf)
  const tNums = targets.map((t) => F.toNumber(t))
  let best: SnappedPlan | null = null
  for (const N of nCandidates()) {
    if (N < targets.length) continue
    let ks = tNums.map((t) => Math.max(1, Math.round((t * N) / Rn)))
    let over = ks.reduce((a, b) => a + b, 0) - N
    let feasible = true
    while (over > 0) {
      let bi = -1
      let bestErr = Infinity
      for (let i = 0; i < ks.length; i++) {
        if (ks[i] <= 1) continue
        const err = Math.abs(((ks[i] - 1) * Rn) / N - tNums[i]) / tNums[i]
        if (err < bestErr) {
          bestErr = err
          bi = i
        }
      }
      if (bi < 0 || bestErr > tolerance) {
        feasible = false
        break
      }
      const next = [...ks]
      next[bi]--
      ks = next
      over--
    }
    if (!feasible) continue
    const errs = ks.map((k, i) => Math.abs((k * Rn) / N - tNums[i]) / tNums[i])
    const maxRelErr = Math.max(...errs)
    if (maxRelErr > tolerance) continue
    if (
      !best ||
      maxRelErr < best.maxRelErr ||
      (maxRelErr === best.maxRelErr && N < best.N)
    ) {
      best = { N, ks, maxRelErr }
    }
  }
  return best
}
