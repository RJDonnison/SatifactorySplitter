import { F, frac, formatFrac, type Frac } from './frac'
import { BELT_SPEEDS, speedOf } from './gameData'
import { NetBuilder, buildTrunk, resetNetIds, type BeltEnd } from './net'
import {
  bestTree,
  buildShareTree,
  chooseExactN,
  chooseSnappedN,
  resetShares,
  type ShareGroup,
} from './shares'
import {
  buildTapChain,
  decomposeTarget,
  mkForSpeed,
  planTapChain,
} from './taps'
import type {
  NetNode,
  Solution,
  SolveInput,
  TargetSpec,
  Warning,
} from './types'
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
  const maxMk = Math.min(6, Math.max(1, Math.round(input.maxMk ?? 6)))
  const notes: Warning[] = []

  // When the inputs cannot share a single belt (total exceeds the max Mk),
  // the largest input becomes the trunk and the smaller inputs feed their
  // outputs directly, joined at the sink — no segment needs a faster belt.
  const cap = speedOf(maxMk)
  if (totalIn > cap && inputRates.every((r) => r <= cap)) {
    const boosted = boostSolve(inputRates, targets, input.tolerance, maxMk)
    if (boosted) return boosted
  }

  const candidates = buildCandidates(
    inputRates,
    Rf,
    targets,
    input.tolerance,
    maxMk,
    notes,
  )
  const best = candidates
    .filter((c) => verify(c, maxMk).ok)
    .sort((a, b) => cmpSolution(a, b))[0]

  if (best) {
    best.warnings.unshift(...notes)
    return best
  }

  if (candidates.length > 0) {
    const capBlocked = candidates.some((c) =>
      verify(c, maxMk).issues.some((i) => i.includes('exceeds the max belt')),
    )
    if (capBlocked) {
      for (let mk = 1; mk <= 6; mk++) {
        const alt = buildCandidates(
          inputRates,
          Rf,
          targets,
          input.tolerance,
          mk,
          [],
        )
        if (alt.some((c) => verify(c, mk).ok)) {
          return fail(
            `Not solvable with belts up to Mk.${maxMk} — the fastest segment needs Mk.${mk} belts. Raise the max belt Mk or lower the rates.`,
          )
        }
      }
    }
    const issues = candidates.flatMap((c) => verify(c, maxMk).issues)
    return fail(
      `Internal error: candidate networks failed verification (${issues[0] ?? '?'})`,
    )
  }
  return fail(
    notes.find((w) => w.level === 'warn')?.text ??
      'No constructible solution within tolerance — try raising the tolerance.',
  )
}

function buildCandidates(
  inputRates: number[],
  Rf: Frac,
  targets: TargetSpec[],
  tolerance: number,
  maxMk: number,
  notes: Warning[],
): Solution[] {
  const candidates: Solution[] = []
  const pure = pureSplitSolution(
    inputRates,
    Rf,
    targets,
    tolerance,
    maxMk,
    notes,
  )
  if (pure) candidates.push(pure)
  const decompByGid = targets.map((t) => decomposeTarget(t.rate, maxMk))
  // Leaving a group untapped (fed from the tail instead) is often cheaper
  // than peeling its coins, so try each single deferral alongside the default.
  const deferSets: ReadonlySet<number>[] = [new Set<number>()]
  decompByGid.forEach((d, gid) => {
    if (d) deferSets.push(new Set([gid]))
  })
  for (const allowPair of [true, false]) {
    for (const defer of deferSets) {
      const tap = tapSolution(
        inputRates,
        Rf,
        targets,
        tolerance,
        maxMk,
        allowPair,
        defer,
        decompByGid,
      )
      if (tap) candidates.push(tap)
    }
  }
  for (const c of BELT_SPEEDS) {
    const chunk = chunkSolution(inputRates, Rf, targets, tolerance, maxMk, c)
    if (chunk) candidates.push(chunk)
  }
  return candidates
}

/** Split overflow belt ends into bins that each fit the max belt Mk
 * (first-fit decreasing); a single oversized end stays on its own belt so
 * verification flags it. Returns the total overflow rate. */
function attachOverflow(b: NetBuilder, ends: BeltEnd[], maxMk: number): Frac {
  const total = ends.reduce((a, e) => F.add(a, e.rate), frac(0))
  if (ends.length === 0) return total
  const cap = frac(speedOf(maxMk))
  const sorted = [...ends].sort((a, c) => F.cmp(c.rate, a.rate))
  const bins: BeltEnd[][] = []
  const sums: Frac[] = []
  for (const e of sorted) {
    let placed = false
    for (let i = 0; i < bins.length; i++) {
      if (F.cmp(F.add(sums[i], e.rate), cap) <= 0) {
        bins[i].push(e)
        sums[i] = F.add(sums[i], e.rate)
        placed = true
        break
      }
    }
    if (!placed) {
      bins.push([e])
      sums.push(e.rate)
    }
  }
  for (let i = 0; i < bins.length; i++) {
    const ovf = b.overflowNode()
    b.mergeInto(bins[i], ovf.id)
    ovf.setRate(sums[i])
  }
  return total
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
  tolerance: number,
): Warning[] {
  const out: Warning[] = []
  targets.forEach((t, i) => {
    if (approximate[i]) {
      const err = (Math.abs(F.toNumber(rates[i]) - t.rate) / t.rate) * 100
      if (err > tolerance * 100 + 1e-9) {
        out.push({
          level: 'warn',
          text: `Output ${t.id}: ${t.rate}/min snapped to ${formatFrac(rates[i])}/min (±${err.toFixed(2)}%), which exceeds the requested ±${(tolerance * 100).toFixed(1)}% tolerance — meeting it exactly would need a very large splitter tree. Raise the tolerance or adjust the rate.`,
        })
      } else {
        out.push({
          level: 'warn',
          text: `Output ${t.id}: ${t.rate}/min is not exactly constructible — snapped to ${formatFrac(rates[i])}/min (±${err.toFixed(2)}%). Raise the tolerance or tweak the rate.`,
        })
      }
    }
  })
  return out
}

/** Snap to the k/N grid, relaxing the tolerance in steps (2x, 5x, 10x, 25%)
 * so a non-constructible tail never kills an otherwise exact design. */
function snapWithFallback(
  R: Frac,
  tFr: Frac[],
  tolerance: number,
): { N: number; ks: number[] } | null {
  const steps = [
    ...new Set([tolerance, tolerance * 2, tolerance * 5, tolerance * 10, 0.25]),
  ]
    .filter((t) => t > 0)
    .sort((a, b) => a - b)
  for (const t of steps) {
    const snap = chooseSnappedN(R, tFr, t)
    if (snap) return snap
  }
  return null
}

/** Pure equal-split candidate (exact grid, or snapped within tolerance). */
function pureSplitSolution(
  inputRates: number[],
  Rf: Frac,
  targets: TargetSpec[],
  tolerance: number,
  maxMk: number,
  notes: Warning[],
): Solution | null {
  const tFr = targets.map((t) => frac(t.rate))
  let N: number
  let ks: number[]
  const exact = chooseExactN(Rf, tFr)
  if (exact) {
    ;({ N, ks } = exact)
  } else {
    const snap = snapWithFallback(Rf, tFr, tolerance)
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

  const b = new NetBuilder(maxMk)
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
  const warnings = approxWarnings(targets, approximate, rates, tolerance)
  if (overflowK > 0) {
    const ovfRate = attachOverflow(b, leafPorts.get(ovfGid) ?? [], maxMk)
    warnings.push({
      level: 'info',
      text: `${formatFrac(ovfRate)}/min surplus is routed to an overflow belt.`,
    })
  }
  const sol = finish(b, targets, approximate, warnings)
  sol.inputRate = Rf
  return sol
}

/** Tap-chain candidate: peel belt-speed amounts, solve the tail with splits.
 * `defer` names target groups left to the tail even though they could be
 * tapped — a target that matches the remainder flow needs no tap at all. */
function tapSolution(
  inputRates: number[],
  Rf: Frac,
  targets: TargetSpec[],
  tolerance: number,
  maxMk: number,
  allowPair: boolean,
  defer: ReadonlySet<number>,
  decompByGid: ReturnType<typeof decomposeTarget>[],
): Solution | null {
  if (!decompByGid.some((c) => c !== null)) return null
  const plan = planTapChain(Rf, decompByGid, allowPair, defer)
  if (!plan) return null

  const usedGids = new Set<number>()
  for (const st of plan.steps) {
    if (st.type === 'tap2') {
      usedGids.add(st.gid)
      for (const s of st.shared?.shares ?? []) usedGids.add(s.gid)
    } else {
      usedGids.add(st.g1)
      usedGids.add(st.g2)
      for (const s of st.shared1?.shares ?? []) usedGids.add(s.gid)
      for (const s of st.shared2?.shares ?? []) usedGids.add(s.gid)
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
      const snap = snapWithFallback(tailR, tailFr, tolerance)
      if (!snap) return null
      tailN = snap.N
      tailKs = snap.ks
    }
  }

  const b = new NetBuilder(maxMk)
  const entry = buildTrunk(b, inputRates)
  const leafPorts = new Map<number, BeltEnd[]>()
  const ovfGid = targets.length
  const drain = buildTapChain(b, plan.steps, entry, leafPorts, ovfGid)

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

  const warnings = approxWarnings(targets, approximate, rates, tolerance)
  const ovfRate = F.sub(
    Rf,
    rates.reduce((a, r) => F.add(a, r), frac(0)),
  )
  if (!F.isZero(ovfRate)) {
    const total = attachOverflow(
      b,
      [...overflowEnds, ...(leafPorts.get(ovfGid) ?? [])],
      maxMk,
    )
    warnings.push({
      level: 'info',
      text: `${formatFrac(total)}/min surplus is routed to an overflow belt.`,
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

/** Chunk candidate: tap one belt-speed chunk off the trunk and solve every
 * target inside it with a pure split; the rest of the input overflows. This
 * is the natural shape when the input far exceeds the demand (780 in, 240
 * needed: peel a 270 chunk instead of tapping each output separately). */
function chunkSolution(
  inputRates: number[],
  Rf: Frac,
  targets: TargetSpec[],
  tolerance: number,
  maxMk: number,
  c: number,
): Solution | null {
  const mk = mkForSpeed(c)
  if (mk > maxMk) return null
  const totalOut = targets.reduce((a, t) => a + t.rate, 0)
  if (c < totalOut) return null // the chunk must be able to carry every target
  if (F.cmp(frac(c), F.div(Rf, frac(2))) > 0) return null // cannot saturate
  const chunkR = frac(c)
  const tailFr = targets.map((t) => frac(t.rate))
  const exact = chooseExactN(chunkR, tailFr)
  const snap = exact ?? snapWithFallback(chunkR, tailFr, tolerance)
  if (!snap) return null
  const { N, ks } = snap
  const rates = ks.map((k) => shareRate(k, chunkR, N))
  const approximate = targets.map((t, i) => !F.eq(rates[i], frac(t.rate)))

  const b = new NetBuilder(maxMk)
  const entry = buildTrunk(b, inputRates)
  const sid = b.splitter([{ limited: true, mk }, { limited: false }])
  b.connect(entry.node, entry.port, sid, 0, entry.rate)
  const chunk: BeltEnd = { node: sid, port: 0, rate: chunkR, tapMk: mk }
  const drain: BeltEnd = {
    node: sid,
    port: 1,
    rate: F.sub(Rf, chunkR),
    tapMk: null,
  }
  const ovfGid = targets.length
  const overflowK = N - ks.reduce((a, k) => a + k, 0)
  const groups: ShareGroup[] = ks
    .map((k, gid) => ({ gid, k }))
    .filter((g) => g.k > 0)
  if (overflowK > 0) groups.push({ gid: ovfGid, k: overflowK })
  resetShares()
  const tree = bestTree(N, groups)
  if (!tree) return null
  const leafPorts = new Map<number, BeltEnd[]>()
  buildShareTree(b, tree, chunk, leafPorts)
  const sinks = targets.map((t, i) => b.sink(t.id, rates[i], approximate[i]))
  targets.forEach((_, i) => b.mergeInto(leafPorts.get(i) ?? [], sinks[i]))
  const warnings = approxWarnings(targets, approximate, rates, tolerance)
  const total = attachOverflow(
    b,
    [...(leafPorts.get(ovfGid) ?? []), drain],
    maxMk,
  )
  if (!F.isZero(total)) {
    warnings.push({
      level: 'info',
      text: `${formatFrac(total)}/min surplus is routed to an overflow belt.`,
    })
  }
  warnings.push({
    level: 'info',
    text: 'Taps (limited belts) rely on belt saturation: keep every remainder belt draining or items will back up.',
  })
  const sol = finish(b, targets, approximate, warnings)
  sol.inputRate = Rf
  return sol
}

/** Solve a problem whose inputs cannot share one belt: the largest input
 * drives the trunk (solved with the normal candidate machinery on reduced
 * outputs), and each smaller input belt feeds an output directly, merged
 * into that output's sink. Returns null when the small belts cannot be
 * assigned whole to outputs. */
function boostSolve(
  inputRates: number[],
  targets: TargetSpec[],
  tolerance: number,
  maxMk: number,
): Solution | null {
  const sorted = [...inputRates].sort((a, b) => b - a)
  const trunk = sorted[0]
  const belts = sorted.slice(1)
  const auxTotal = belts.reduce((a, b) => a + b, 0)

  // assign each small belt whole to the output with the most spare rate
  // (at most two per output — a sink merger has three inputs)
  const spare = new Map(targets.map((t) => [t.id, t.rate]))
  const count = new Map<string, number>()
  const picked = new Map<string, number[]>()
  for (const belt of belts) {
    let best: TargetSpec | null = null
    for (const t of targets) {
      if ((spare.get(t.id) ?? 0) < belt - 1e-9) continue
      if ((count.get(t.id) ?? 0) >= 2) continue
      if (!best || (spare.get(t.id) ?? 0) > (spare.get(best.id) ?? 0)) best = t
    }
    if (!best) return null
    spare.set(best.id, (spare.get(best.id) ?? 0) - belt)
    count.set(best.id, (count.get(best.id) ?? 0) + 1)
    const list = picked.get(best.id) ?? []
    list.push(belt)
    picked.set(best.id, list)
  }

  const reduced: TargetSpec[] = []
  const dropped: TargetSpec[] = []
  for (const t of targets) {
    const used = (picked.get(t.id) ?? []).reduce((a, b) => a + b, 0)
    if (t.rate - used > 1e-9) reduced.push({ id: t.id, rate: t.rate - used })
    else dropped.push(t)
  }

  const b = new NetBuilder(maxMk)
  let sub: Solution
  if (reduced.length > 0) {
    const cands = buildCandidates(
      [trunk],
      frac(trunk),
      reduced,
      tolerance,
      maxMk,
      [],
    )
    const best = cands.filter((c) => verify(c, maxMk).ok).sort(cmpSolution)[0]
    if (!best) return null
    sub = best
  } else {
    // every output is fed entirely by the small belts; the trunk overflows
    const trunkEnd = buildTrunk(b, [trunk])
    const ovf = b.overflowNode()
    b.connect(trunkEnd.node, trunkEnd.port, ovf.id, 0, trunkEnd.rate)
    ovf.setRate(trunkEnd.rate)
    sub = finish(
      b,
      targets,
      targets.map(() => false),
      [
        {
          level: 'info',
          text: `${formatFrac(trunkEnd.rate)}/min surplus is routed to an overflow belt.`,
        },
      ],
    )
    sub.inputRate = frac(trunk)
  }

  // splice the small belts in: one fresh merger joins each boosted sink's
  // existing feed with its assigned belts (ports 1-2, feed moves to port 0)
  for (const t of targets) {
    const list = picked.get(t.id)
    if (!list) continue
    const ends = list.map((r) => {
      const src = b.source(frac(r))
      return { node: src, port: 0, rate: frac(r), tapMk: null }
    })
    let sinkId: string
    if (dropped.includes(t)) {
      sinkId = b.sink(t.id, frac(t.rate), false)
      b.mergeInto(ends, sinkId)
    } else {
      const sink = sub.nodes.find(
        (n): n is Extract<NetNode, { kind: 'sink' }> =>
          n.kind === 'sink' && n.target === t.id,
      )
      if (!sink) return null
      sinkId = sink.id
      const feed = sub.edges.find((e) => e.dst === sinkId)
      if (!feed) return null
      const achieved = F.add(feed.rate, frac(list.reduce((a, c) => a + c, 0)))
      sink.rate = achieved
      if (!F.eq(achieved, frac(t.rate))) sink.approximate = true
      const mg = b.merger()
      feed.dst = mg
      feed.dstPort = 0
      ends.forEach((e, i) => b.connect(e.node, e.port, mg, i + 1, e.rate))
      b.connect(mg, 0, sinkId, 0, achieved)
    }
  }

  sub.nodes.push(...b.nodes)
  sub.edges.push(...b.edges)
  sub.buildings.mergers += b.nodes.filter((n) => n.kind === 'merger').length
  sub.excess += b.edges.reduce(
    (acc, e) => acc + (e.minMk ? speedOf(e.minMk) - F.toNumber(e.rate) : 0),
    0,
  )
  sub.outputIds = targets.map((t) => t.id)
  sub.inputRate = frac(trunk + auxTotal)
  sub.warnings.unshift({
    level: 'info',
    text: `Inputs exceed one Mk.${maxMk} belt — ${auxTotal}/min of small inputs join at the outputs instead of a merged trunk.`,
  })
  return verify(sub, maxMk).ok ? sub : null
}
