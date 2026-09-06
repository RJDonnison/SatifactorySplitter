import { F, frac, formatFrac, type Frac } from './frac'
import { speedOf } from './gameData'
import { NetBuilder, buildTrunk, resetNetIds, type BeltEnd } from './net'
import {
  bestTree,
  buildShareTree,
  chooseExactN,
  chooseSnappedN,
  resetShares,
  type ShareGroup,
} from './shares'
import { buildTapChain, coinDecomp, planTapChain } from './taps'
import type { Solution, SolveInput, TargetSpec, Warning } from './types'
import { verify } from './verify'

export function solve(input: SolveInput): Solution {
  resetNetIds()
  resetShares()
  const inputRates = input.inputs.filter((r) => Number.isFinite(r) && r > 0)
  const targets: TargetSpec[] = input.outputs.filter(
    (o) => Number.isFinite(o.rate) && o.rate > 0,
  )
  if (inputRates.length === 0 || targets.length === 0)
    return fail(
      'Add at least one input and one output belt with a rate above zero.',
    )
  const totalIn = inputRates.reduce((a, b) => a + b, 0)
  if (totalIn > 1200)
    return fail(
      `Total input of ${totalIn}/min exceeds the fastest belt (Mk.6 = 1200/min).`,
    )
  const totalOut = targets.reduce((a, b) => a + b.rate, 0)
  if (totalOut > totalIn)
    return fail(
      `Requested outputs (${totalOut}/min) exceed the input (${totalIn}/min).`,
    )

  const Rf = frac(totalIn)
  const notes: Warning[] = []
  const candidates: Solution[] = []

  const pure = pureSplitSolution(
    inputRates,
    Rf,
    targets,
    input.tolerance,
    notes,
  )
  if (pure) candidates.push(pure)
  for (const allowPair of [true, false]) {
    const tap = tapSolution(inputRates, Rf, targets, input.tolerance, allowPair)
    if (tap) candidates.push(tap)
  }

  const best = candidates
    .filter((c) => verify(c).ok)
    .sort((a, b) => cmpSolution(a, b))[0]

  if (!best) {
    if (candidates.length > 0) {
      const issues = candidates.flatMap((c) => verify(c).issues)
      return fail(
        `Internal error: candidate networks failed verification (${issues[0] ?? '?'})`,
      )
    }
    return fail(
      notes.find((w) => w.level === 'warn')?.text ??
        'No constructible solution within tolerance — try raising the tolerance.',
    )
  }
  best.warnings.unshift(...notes)
  return best
}

function cmpSolution(a: Solution, b: Solution): number {
  return (
    a.approximateCount - b.approximateCount ||
    a.buildings.splitters +
      a.buildings.mergers -
      (b.buildings.splitters + b.buildings.mergers) ||
    a.excess - b.excess
  )
}

function fail(text: string): Solution {
  return {
    ok: false,
    nodes: [],
    edges: [],
    warnings: [{ level: 'error', text }],
    inputRate: frac(0),
    outputIds: [],
    buildings: { splitters: 0, mergers: 0 },
    excess: 0,
    approximateCount: 0,
  }
}

function finish(
  b: NetBuilder,
  targets: TargetSpec[],
  approximate: boolean[],
  warnings: Warning[],
): Solution {
  const splitters = b.nodes.filter((n) => n.kind === 'splitter').length
  const mergers = b.nodes.filter((n) => n.kind === 'merger').length
  const excess = b.edges.reduce(
    (acc, e) => acc + (e.minMk ? speedOf(e.minMk) - F.toNumber(e.rate) : 0),
    0,
  )
  return {
    ok: true,
    nodes: b.nodes,
    edges: b.edges,
    warnings,
    inputRate: frac(0),
    outputIds: targets.map((t) => t.id),
    buildings: { splitters, mergers },
    excess,
    approximateCount: approximate.filter(Boolean).length,
  }
}

function shareRate(k: number, R: Frac, N: number): Frac {
  return F.div(F.mul(frac(k), R), frac(N))
}

function approxWarnings(
  targets: TargetSpec[],
  approximate: boolean[],
  rates: Frac[],
): Warning[] {
  const out: Warning[] = []
  targets.forEach((t, i) => {
    if (approximate[i]) {
      const err = (Math.abs(F.toNumber(rates[i]) - t.rate) / t.rate) * 100
      out.push({
        level: 'warn',
        text: `Output ${t.id}: ${t.rate}/min is not exactly constructible — snapped to ${formatFrac(rates[i])}/min (±${err.toFixed(2)}%). Raise the tolerance or tweak the rate.`,
      })
    }
  })
  return out
}

/** Pure equal-split candidate (exact grid, or snapped within tolerance). */
function pureSplitSolution(
  inputRates: number[],
  Rf: Frac,
  targets: TargetSpec[],
  tolerance: number,
  notes: Warning[],
): Solution | null {
  const tFr = targets.map((t) => frac(t.rate))
  let N: number
  let ks: number[]
  const exact = chooseExactN(Rf, tFr)
  if (exact) {
    ;({ N, ks } = exact)
  } else {
    const snap = chooseSnappedN(Rf, tFr, tolerance)
    if (!snap) {
      notes.push({
        level: 'warn',
        text: 'No pure-split layout exists for these ratios within the tolerance.',
      })
      return null
    }
    ;({ N, ks } = snap)
  }
  const rates = ks.map((k) => shareRate(k, Rf, N))
  const approximate = targets.map((t, i) => !F.eq(rates[i], frac(t.rate)))

  const b = new NetBuilder()
  const entry = buildTrunk(b, inputRates)
  const ovfGid = targets.length
  const overflowK = N - ks.reduce((a, c) => a + c, 0)
  const groups: ShareGroup[] = ks
    .map((k, gid) => ({ gid, k }))
    .filter((g) => g.k > 0)
  if (overflowK > 0) groups.push({ gid: ovfGid, k: overflowK })
  resetShares()
  const tree = bestTree(N, groups)
  if (!tree) return null
  const leafPorts = new Map<number, BeltEnd[]>()
  buildShareTree(b, tree, entry, leafPorts)
  const sinks = targets.map((t, i) => b.sink(t.id, rates[i], approximate[i]))
  targets.forEach((_, i) => b.mergeInto(leafPorts.get(i) ?? [], sinks[i]))
  const warnings = approxWarnings(targets, approximate, rates)
  if (overflowK > 0) {
    const ovfRate = shareRate(overflowK, Rf, N)
    const ovf = b.overflowNode()
    b.mergeInto(leafPorts.get(ovfGid) ?? [], ovf.id)
    ovf.setRate(ovfRate)
    warnings.push({
      level: 'info',
      text: `${formatFrac(ovfRate)}/min surplus is routed to an overflow belt.`,
    })
  }
  const sol = finish(b, targets, approximate, warnings)
  sol.inputRate = Rf
  return sol
}

/** Tap-chain candidate: peel belt-speed amounts, solve the tail with splits. */
function tapSolution(
  inputRates: number[],
  Rf: Frac,
  targets: TargetSpec[],
  tolerance: number,
  allowPair: boolean,
): Solution | null {
  const coinsByGid = targets.map((t) => coinDecomp(t.rate))
  if (!coinsByGid.some((c) => c !== null)) return null
  const plan = planTapChain(Rf, coinsByGid, allowPair)
  if (!plan) return null

  const usedGids = new Set<number>()
  for (const st of plan.steps) {
    if (st.type === 'tap2') usedGids.add(st.gid)
    else {
      usedGids.add(st.g1)
      usedGids.add(st.g2)
    }
  }
  const tailIdx: number[] = []
  targets.forEach((_, i) => {
    if (!usedGids.has(i)) tailIdx.push(i)
  })
  const tailTargets = tailIdx.map((i) => targets[i])
  const tailR = plan.remainder

  let tailN = 1
  let tailKs: number[] = []
  if (tailTargets.length > 0) {
    const tailFr = tailTargets.map((t) => frac(t.rate))
    const exact = chooseExactN(tailR, tailFr)
    if (exact) {
      tailN = exact.N
      tailKs = exact.ks
    } else {
      const snap = chooseSnappedN(tailR, tailFr, tolerance)
      if (!snap) return null
      tailN = snap.N
      tailKs = snap.ks
    }
  }

  const b = new NetBuilder()
  const entry = buildTrunk(b, inputRates)
  const leafPorts = new Map<number, BeltEnd[]>()
  const drain = buildTapChain(b, plan.steps, entry, leafPorts)

  const ovfGid = targets.length
  const overflowEnds: BeltEnd[] = []
  if (tailTargets.length > 0) {
    const overflowK = tailN - tailKs.reduce((a, c) => a + c, 0)
    const groups: ShareGroup[] = tailKs
      .map((k, gid) => ({ gid, k }))
      .filter((g) => g.k > 0)
    if (overflowK > 0) groups.push({ gid: tailTargets.length, k: overflowK })
    resetShares()
    const tree = bestTree(tailN, groups)
    if (!tree) return null
    const tailLeaf = new Map<number, BeltEnd[]>()
    buildShareTree(b, tree, drain, tailLeaf)
    tailLeaf.forEach((ends, localGid) => {
      const globalGid =
        localGid === tailTargets.length ? ovfGid : tailIdx[localGid]
      leafPorts.set(globalGid, [...(leafPorts.get(globalGid) ?? []), ...ends])
    })
  } else if (!F.isZero(tailR)) {
    overflowEnds.push(drain)
  }

  const rates = targets.map((t, i) => {
    if (usedGids.has(i)) return frac(t.rate)
    const li = tailIdx.indexOf(i)
    return shareRate(tailKs[li], tailR, tailN)
  })
  const approximate = targets.map((t, i) => !F.eq(rates[i], frac(t.rate)))
  const sinks = targets.map((t, i) => b.sink(t.id, rates[i], approximate[i]))
  targets.forEach((_, i) => b.mergeInto(leafPorts.get(i) ?? [], sinks[i]))

  const warnings = approxWarnings(targets, approximate, rates)
  const ovfRate = F.sub(
    Rf,
    rates.reduce((a, r) => F.add(a, r), frac(0)),
  )
  if (!F.isZero(ovfRate)) {
    const ovf = b.overflowNode()
    b.mergeInto([...overflowEnds, ...(leafPorts.get(ovfGid) ?? [])], ovf.id)
    ovf.setRate(ovfRate)
    warnings.push({
      level: 'info',
      text: `${formatFrac(ovfRate)}/min surplus is routed to an overflow belt.`,
    })
  }
  if (plan.steps.length > 0) {
    warnings.push({
      level: 'info',
      text: 'Taps (limited belts) rely on belt saturation: keep every remainder belt draining or items will back up.',
    })
  }
  const sol = finish(b, targets, approximate, warnings)
  sol.inputRate = Rf
  return sol
}
