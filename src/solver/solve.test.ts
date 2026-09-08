import { describe, expect, it } from 'vitest'
import { F, frac } from './frac'
import { minMkFor } from './gameData'
import { coinDecomp } from './taps'
import { solve } from './solve'
import type { Solution } from './types'
import { verify } from './verify'

const S = (inputs: number[], outputs: number[], tolerance = 0.01): Solution =>
  solve({
    inputs,
    outputs: outputs.map((rate, i) => ({ id: `out${i + 1}`, rate })),
    tolerance,
  })

const Smax = (
  inputs: number[],
  outputs: number[],
  maxMk: number,
  tolerance = 0.01,
): Solution =>
  solve({
    inputs,
    outputs: outputs.map((rate, i) => ({ id: `out${i + 1}`, rate })),
    tolerance,
    maxMk,
  })

function sinksOf(s: Solution) {
  return s.nodes.filter((n) => n.kind === 'sink') as Extract<
    (typeof s.nodes)[number],
    { kind: 'sink' }
  >[]
}

function ratesByTarget(s: Solution): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of sinksOf(s)) out[n.target] = F.toNumber(n.rate)
  return out
}

const totalBuildings = (s: Solution) =>
  s.buildings.splitters + s.buildings.mergers

describe('frac', () => {
  it('normalizes and compares', () => {
    expect(F.eq(frac(1, 2), frac(3, 6))).toBe(true)
    expect(F.cmp(frac(2, 3), frac(3, 4))).toBeLessThan(0)
    expect(F.isInt(F.div(frac(6), frac(3)))).toBe(true)
  })
})

describe('gameData', () => {
  it('maps rates to minimum belt marks', () => {
    expect(minMkFor(frac(60))).toBe(1)
    expect(minMkFor(frac(61))).toBe(2)
    expect(minMkFor(frac(270))).toBe(3)
    expect(minMkFor(frac(1200))).toBe(6)
    expect(minMkFor(frac(1201))).toBeNull()
  })
})

describe('coinDecomp', () => {
  it('finds minimum coin counts', () => {
    expect(coinDecomp(180)).toEqual([120, 60])
    expect(coinDecomp(600)).toEqual([480, 120])
    expect(coinDecomp(90)).toBeNull()
    expect(coinDecomp(59)).toBeNull()
  })
})

describe('solve — exact equal splits', () => {
  it('780 -> 390,390 is a single 2-way splitter', () => {
    const s = S([780], [390, 390])
    expect(s.ok).toBe(true)
    expect(s.buildings).toEqual({ splitters: 1, mergers: 0 })
    expect(ratesByTarget(s)).toEqual({ out1: 390, out2: 390 })
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 260 x3 is a single 3-way splitter', () => {
    const s = S([780], [260, 260, 260])
    expect(s.ok).toBe(true)
    expect(s.buildings).toEqual({ splitters: 1, mergers: 0 })
    expect(verify(s).ok).toBe(true)
  })

  it('240 -> 60,60,120 uses a single splitter with two Mk.1 taps', () => {
    const s = S([240], [60, 60, 120])
    expect(s.ok).toBe(true)
    expect(totalBuildings(s)).toBe(1)
    expect(ratesByTarget(s)).toEqual({ out1: 60, out2: 60, out3: 120 })
    expect(s.edges.filter((e) => e.tapMk === 1).length).toBe(2)
    expect(verify(s).ok).toBe(true)
  })

  it('100 -> 780 is a pass-through with zero buildings', () => {
    const s = S([780], [780])
    expect(s.ok).toBe(true)
    expect(totalBuildings(s)).toBe(0)
    expect(verify(s).ok).toBe(true)
  })

  it('multi-input merges into a trunk', () => {
    const s = S([480, 300], [780])
    expect(s.ok).toBe(true)
    expect(s.buildings).toEqual({ splitters: 0, mergers: 1 })
    expect(verify(s).ok).toBe(true)
  })
})

describe('solve — belt taps', () => {
  it('780 -> 60,720 is one splitter with a Mk.1 tap', () => {
    const s = S([780], [60, 720])
    expect(s.ok).toBe(true)
    expect(s.buildings).toEqual({ splitters: 1, mergers: 0 })
    expect(ratesByTarget(s)).toEqual({ out1: 60, out2: 720 })
    expect(s.edges.some((e) => e.tapMk === 1)).toBe(true)
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 180,600 is exact via taps (user example)', () => {
    const s = S([780], [180, 600])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(totalBuildings(s)).toBe(2)
    expect(ratesByTarget(s)).toEqual({ out1: 180, out2: 600 })
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 300,300 is exact via taps with overflow', () => {
    const s = S([780], [300, 300])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(totalBuildings(s)).toBeLessThanOrEqual(5)
    expect(ratesByTarget(s)).toEqual({ out1: 300, out2: 300 })
    const ovf = s.nodes.find((n) => n.kind === 'overflow')
    expect(ovf && F.toNumber(ovf.rate)).toBe(180)
    expect(verify(s).ok).toBe(true)
  })

  it('240 -> 60 x4 beats the naive 3-splitter tree', () => {
    const s = S([240], [60, 60, 60, 60])
    expect(s.ok).toBe(true)
    expect(totalBuildings(s)).toBe(2)
    expect(verify(s).ok).toBe(true)
  })

  it('rejects taps that cannot saturate: 330 -> 270 uses a tail split instead', () => {
    const s = S([330], [270, 60])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(s.buildings.splitters).toBe(1)
    expect(ratesByTarget(s)).toEqual({ out1: 270, out2: 60 })
    expect(verify(s).ok).toBe(true)
  })
})

describe('solve — tail deferral (user reports)', () => {
  it('780 -> 60,15,15,150 is exact in 7 buildings, not a tap cascade', () => {
    const s = S([780], [60, 15, 15, 150])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(totalBuildings(s)).toBeLessThanOrEqual(7)
    expect(ratesByTarget(s)).toEqual({
      out1: 60,
      out2: 15,
      out3: 15,
      out4: 150,
    })
    expect(verify(s).ok).toBe(true)
  })

  it('270 -> 60,15,15,150 is exact in 3 buildings via tap3 + tail', () => {
    const s = S([270], [60, 15, 15, 150])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(totalBuildings(s)).toBeLessThanOrEqual(3)
    expect(ratesByTarget(s)).toEqual({
      out1: 60,
      out2: 15,
      out3: 15,
      out4: 150,
    })
    expect(verify(s).ok).toBe(true)
  })
})

describe('solve — approximation', () => {
  it('780 -> 156,624 snaps within tolerance and is flagged approximate', () => {
    const s = S([780], [156, 624])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBeGreaterThan(0)
    const r = ratesByTarget(s)
    expect(Math.abs(r.out1 - 156) / 156).toBeLessThanOrEqual(0.01)
    expect(Math.abs(r.out2 - 624) / 624).toBeLessThanOrEqual(0.01)
    expect(verify(s).ok).toBe(true)
    expect(s.warnings.some((w) => w.text.includes('snapped'))).toBe(true)
  })

  it('100 -> 20,80 snaps within 1%', () => {
    const s = S([100], [20, 80])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(2)
    const r = ratesByTarget(s)
    expect(Math.abs(r.out1 - 20) / 20).toBeLessThanOrEqual(0.01)
    expect(Math.abs(r.out2 - 80) / 80).toBeLessThanOrEqual(0.01)
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 150 uses a Mk.2 tap plus a split Mk.1 piece (2 splitters, 1 merger)', () => {
    const s = S([780], [150])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(s.buildings.splitters).toBe(2)
    expect(s.buildings.mergers).toBe(2)
    const r = ratesByTarget(s)
    expect(r.out1).toBe(150)
    expect(s.warnings.some((w) => w.text.includes('overflow'))).toBe(true)
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 30 uses a Mk.1 tap split two ways', () => {
    const s = S([780], [30])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(s.buildings.splitters).toBe(2)
    expect(ratesByTarget(s).out1).toBe(30)
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 60,150,2 keeps the tap-able outputs exact and only snaps the 2', () => {
    const s = S([780], [60, 150, 2])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(1)
    const r = ratesByTarget(s)
    expect(r.out1).toBe(60)
    expect(r.out2).toBe(150)
    expect(Math.abs(r.out3 - 2) / 2).toBeLessThanOrEqual(0.02)
    expect(s.edges.some((e) => e.tapMk !== null)).toBe(true)
    expect(s.warnings.some((w) => w.text.includes('snapped'))).toBe(true)
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 50 is exact via Mk.1 piece taps', () => {
    const s = S([780], [50])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(ratesByTarget(s).out1).toBe(50)
    expect(s.edges.some((e) => e.tapMk === 1)).toBe(true)
    expect(verify(s).ok).toBe(true)
  })

  it('780 -> 110 is exact via mixed-tier piece taps (90 + 20 merged)', () => {
    const s = S([780], [110])
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(ratesByTarget(s).out1).toBe(110)
    expect(verify(s).ok).toBe(true)
  })
})

describe('solve — errors', () => {
  it('rejects outputs exceeding input', () => {
    const s = S([60], [120, 60])
    expect(s.ok).toBe(false)
    expect(s.warnings[0].level).toBe('error')
  })

  it('rejects input above Mk.6 throughput', () => {
    const s = S([2000], [1000])
    expect(s.ok).toBe(false)
  })

  it('rejects empty problems', () => {
    expect(S([], [60]).ok).toBe(false)
    expect(S([60], []).ok).toBe(false)
  })
})

describe('solve — max belt Mk cap', () => {
  it('coin decomps respect the cap', () => {
    expect(coinDecomp(180, 2)).toEqual([120, 60])
    expect(coinDecomp(180, 1)).toEqual([60, 60, 60])
    expect(coinDecomp(150, 1)).toBeNull()
  })

  it('780 -> 260 x3 stays solvable at max Mk.3 (input belt is exempt)', () => {
    const s = Smax([780], [260, 260, 260], 3)
    expect(s.ok).toBe(true)
    expect(s.buildings.splitters).toBe(1)
    for (const e of s.edges) {
      if (e.tapMk === null && e.src.startsWith('src')) continue
      expect(e.minMk === null || e.minMk <= 3).toBe(true)
    }
    expect(verify(s, 3).ok).toBe(true)
  })

  it('780 -> 390,390 at max Mk.3 errors with a minimum-workable-tier hint', () => {
    const s = Smax([780], [390, 390], 3)
    expect(s.ok).toBe(false)
    const msg = s.warnings.find((w) => w.level === 'error')?.text ?? ''
    expect(msg).toContain('Mk.4')
  })

  it('240 -> 60,60,120 at max Mk.1 errors (120/min segments need Mk.2)', () => {
    const s = Smax([240], [60, 60, 120], 1)
    expect(s.ok).toBe(false)
    const msg = s.warnings.find((w) => w.level === 'error')?.text ?? ''
    expect(msg).toContain('Mk.2')
  })

  it('caps multi-input trunks (merged trunk is a placed belt)', () => {
    const s = Smax([480, 480], [960], 4)
    expect(s.ok).toBe(false)
  })
})

describe('solve — shared tap pieces', () => {
  it('780 -> 60,150,30 shares one 60 tap split between the 150 and 30 outputs', () => {
    const s = solve({
      inputs: [780],
      outputs: [
        { id: 'out1', rate: 60 },
        { id: 'out2', rate: 150 },
        { id: 'out3', rate: 30 },
      ],
      tolerance: 0.01,
    })
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(s.buildings.splitters).toBe(3)
    expect(s.buildings.mergers).toBe(1)
    expect(ratesByTarget(s)).toEqual({ out1: 60, out2: 150, out3: 30 })
    expect(verify(s).ok).toBe(true)
  })

  it('480 -> 60,150,30 also prefers the shared tap design', () => {
    const s = solve({
      inputs: [480],
      outputs: [
        { id: 'out1', rate: 60 },
        { id: 'out2', rate: 150 },
        { id: 'out3', rate: 30 },
      ],
      tolerance: 0.01,
    })
    expect(s.ok).toBe(true)
    expect(s.approximateCount).toBe(0)
    expect(
      s.edges.filter((e) => e.tapMk !== null).length,
    ).toBeGreaterThanOrEqual(2)
    expect(ratesByTarget(s)).toEqual({ out1: 60, out2: 150, out3: 30 })
    expect(verify(s).ok).toBe(true)
  })
})

describe('solve — inputs that exceed one belt', () => {
  it('feeds small inputs straight into outputs instead of a merged trunk', () => {
    const s = Smax([780, 20], [240, 150, 180, 60, 72, 42, 48], 5)
    expect(s.ok).toBe(true)
    expect(verify(s, 5).ok).toBe(true)
    const rates = ratesByTarget(s)
    const want = [240, 150, 180, 60, 72, 42, 48]
    want.forEach((w, i) => {
      expect(Math.abs(rates[`out${i + 1}`] - w)).toBeLessThanOrEqual(w * 0.06)
    })
    expect(s.warnings.some((w) => w.text.includes('join at the outputs'))).toBe(
      true,
    )
    const maxEdge = Math.max(...s.edges.map((e) => F.toNumber(e.rate)))
    expect(maxEdge).toBeLessThanOrEqual(780)
  })

  it('still errors when a small belt cannot be assigned whole', () => {
    const s = Smax([780, 20], [15], 5)
    expect(s.ok).toBe(false)
    expect(s.warnings[0].text).toMatch(/Mk\.6/)
  })

  it('keeps using a merged trunk while it fits the cap', () => {
    const s = Smax([480, 300], [780], 6)
    expect(s.ok).toBe(true)
    expect(s.buildings).toEqual({ splitters: 0, mergers: 1 })
    expect(verify(s, 6).ok).toBe(true)
  })
})
