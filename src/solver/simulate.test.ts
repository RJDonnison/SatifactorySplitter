import { describe, expect, it } from 'vitest'
import { simulate, type SimDoc, type SimEdge, type SimNode } from './simulate'
import { solve } from './solve'
import { snapshotDoc } from '../state/doc'
import { F, frac, type Frac } from './frac'

const near = (a: Frac, b: Frac, eps = 1e-4) =>
  Math.abs(F.toNumber(a) - F.toNumber(b)) < eps

const node = (n: SimNode) => n
const edge = (
  id: string,
  src: string,
  srcPort: number,
  dst: string,
  dstPort: number,
  mk: number | null = null,
): SimEdge => ({ id, src, srcPort, dst, dstPort, mk })

describe('simulate — fidelity invariant (solver layout snapshot)', () => {
  const cases: [string, number[], number[]][] = [
    ['780 -> 60,15,15,150', [780], [60, 15, 15, 150]],
    ['480+300 -> 780', [480, 300], [780]],
    ['780 -> 156,624 (snapped)', [780], [156, 624]],
    ['240 -> 60,60,120 (taps)', [240], [60, 60, 120]],
  ]
  for (const [name, inputs, outputs] of cases) {
    it(`reproduces the solver rates for ${name}`, async () => {
      const sol = solve({
        inputs,
        outputs: outputs.map((rate, i) => ({ id: `o${i}`, rate })),
        tolerance: 0.01,
        maxMk: 6,
      })
      expect(sol.ok).toBe(true)
      const doc = await snapshotDoc(sol)
      const sim = simulate(doc, 6)
      // every solver sink rate is reproduced on the matching doc sink
      for (const n of sol.nodes) {
        if (n.kind !== 'sink') continue
        const s = sim.sinks.get(n.id)
        expect(s, `sink ${n.id}`).toBeDefined()
        expect(near(s!.achieved, n.rate)).toBe(true)
      }
      // every solver edge rate is reproduced on the matching doc edge
      const byEnds = new Map(
        doc.edges.map((e) => [
          `${e.src}:${e.srcPort}>${e.dst}:${e.dstPort}`,
          e,
        ]),
      )
      for (const e of sol.edges) {
        const de = byEnds.get(`${e.src}:${e.srcPort}>${e.dst}:${e.dstPort}`)
        expect(de, `edge ${e.id}`).toBeDefined()
        expect(near(sim.edges.get(de!.id) ?? frac(0), e.rate)).toBe(true)
      }
      // overflow nodes become valves that pass everything through
      for (const n of sol.nodes) {
        if (n.kind !== 'overflow') continue
        const v = sim.valves.get(n.id)
        expect(v, `valve ${n.id}`).toBeDefined()
        expect(near(v!.inflow, n.rate)).toBe(true)
        expect(F.isZero(v!.discarded)).toBe(true)
      }
    })
  }
})

describe('simulate — node semantics', () => {
  it('valve passes through anything a Mk.6 belt can carry', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 780 }),
        node({ id: 'v', kind: 'overflow' }),
        node({ id: 'k', kind: 'sink', rate: 780 }),
      ],
      edges: [edge('e0', 's', 0, 'v', 0), edge('e1', 'v', 0, 'k', 0)],
    }
    const sim = simulate(doc)
    const v = sim.valves.get('v')!
    expect(near(v.outflow, frac(780))).toBe(true)
    expect(F.isZero(v.discarded)).toBe(true)
    expect(near(sim.sinks.get('k')!.achieved, frac(780))).toBe(true)
  })

  it('valve discards beyond a full belt and warns', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 'a', kind: 'source', rate: 780 }),
        node({ id: 'b', kind: 'source', rate: 780 }),
        node({ id: 'm', kind: 'merger' }),
        node({ id: 'v', kind: 'overflow' }),
      ],
      edges: [
        edge('e0', 'a', 0, 'm', 0),
        edge('e1', 'b', 0, 'm', 1),
        edge('e2', 'm', 0, 'v', 0),
      ],
    }
    const sim = simulate(doc)
    const v = sim.valves.get('v')!
    expect(near(v.inflow, frac(1560))).toBe(true)
    expect(near(v.outflow, frac(1200))).toBe(true)
    expect(near(v.discarded, frac(360))).toBe(true)
    expect(sim.warnings.some((w) => w.text.includes('discards 360'))).toBe(true)
  })

  it('splits evenly between connected ports only', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 270 }),
        node({
          id: 'sp',
          kind: 'splitter',
          ports: [{ limited: false }, { limited: false }, { limited: false }],
        }),
        node({ id: 'k', kind: 'sink', rate: 135 }),
      ],
      edges: [edge('e0', 's', 0, 'sp', 0), edge('e1', 'sp', 0, 'k', 0)],
    }
    const sim = simulate(doc)
    expect(near(sim.edges.get('e1')!, frac(270))).toBe(true)
  })

  it('back-pressure pins tap ports at their belt cap', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 180 }),
        node({
          id: 'sp',
          kind: 'splitter',
          ports: [{ limited: true, mk: 1 }, { limited: false }],
        }),
        node({ id: 'k1', kind: 'sink', rate: 60 }),
        node({ id: 'k2', kind: 'sink', rate: 120 }),
      ],
      edges: [
        edge('e0', 's', 0, 'sp', 0),
        edge('e1', 'sp', 0, 'k1', 0),
        edge('e2', 'sp', 1, 'k2', 0),
      ],
    }
    const sim = simulate(doc)
    expect(near(sim.edges.get('e1')!, frac(60))).toBe(true)
    expect(near(sim.edges.get('e2')!, frac(120))).toBe(true)
    expect(near(sim.sinks.get('k1')!.achieved, frac(60))).toBe(true)
  })

  it('warns when tap ports alone cannot drain a splitter', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 780 }),
        node({
          id: 'sp',
          kind: 'splitter',
          ports: [
            { limited: true, mk: 1 },
            { limited: true, mk: 1 },
          ],
        }),
        node({ id: 'k1', kind: 'sink', rate: 60 }),
        node({ id: 'k2', kind: 'sink', rate: 60 }),
      ],
      edges: [
        edge('e0', 's', 0, 'sp', 0),
        edge('e1', 'sp', 0, 'k1', 0),
        edge('e2', 'sp', 1, 'k2', 0),
      ],
    }
    const sim = simulate(doc)
    expect(sim.warnings.some((w) => w.text.includes('stalls'))).toBe(true)
    expect(near(sim.edges.get('e1')!, frac(60))).toBe(true)
    expect(near(sim.edges.get('e2')!, frac(60))).toBe(true)
  })

  it('under- and over-supplied sinks warn', () => {
    const under: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 60 }),
        node({ id: 'k', kind: 'sink', rate: 120 }),
      ],
      edges: [edge('e0', 's', 0, 'k', 0)],
    }
    expect(
      simulate(under).warnings.some((w) => w.text.includes('under-supplied')),
    ).toBe(true)

    const over: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 780 }),
        node({ id: 'k', kind: 'sink', rate: 60 }),
      ],
      edges: [edge('e0', 's', 0, 'k', 0)],
    }
    expect(
      simulate(over).warnings.some((w) => w.text.includes('over-supplied')),
    ).toBe(true)
  })

  it('warns on belts pinned below their flow and flows beyond maxMk', () => {
    const pinned: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 480 }),
        node({ id: 'k', kind: 'sink', rate: 480 }),
      ],
      edges: [edge('e0', 's', 0, 'k', 0, 1)],
    }
    expect(
      simulate(pinned).warnings.some((w) => w.text.includes('pinned to Mk.1')),
    ).toBe(true)

    const beyond: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 480 }),
        node({ id: 'k', kind: 'sink', rate: 480 }),
      ],
      edges: [edge('e0', 's', 0, 'k', 0)],
    }
    expect(
      simulate(beyond, 3).warnings.some((w) => w.text.includes('Mk.3 belt')),
    ).toBe(true)
  })

  it('sink receives nothing warns when an output dangles', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 60 }),
        node({ id: 'k', kind: 'sink', rate: 60 }),
      ],
      edges: [edge('e0', 's', 0, 'k', 0)],
    }
    const doc2: SimDoc = { nodes: doc.nodes, edges: [] }
    expect(
      simulate(doc2).warnings.some((w) => w.text.includes('receives nothing')),
    ).toBe(true)
  })
})

describe('simulate — loops', () => {
  const loopDoc = (): SimDoc => {
    // 60/min into a merger; splitter sends half back into the merger and
    // half out: steady state merger = 120, sink = 60
    const nodes: SimNode[] = [
      node({ id: 's', kind: 'source', rate: 60 }),
      node({ id: 'm', kind: 'merger' }),
      node({
        id: 'sp',
        kind: 'splitter',
        ports: [{ limited: false }, { limited: false }],
      }),
      node({ id: 'k', kind: 'sink', rate: 60 }),
    ]
    return {
      nodes,
      edges: [
        edge('e0', 's', 0, 'm', 0),
        edge('e1', 'm', 0, 'sp', 0),
        edge('e2', 'sp', 0, 'k', 0),
        edge('e3', 'sp', 1, 'm', 1),
      ],
    }
  }

  it('converges on a splitter-feedback loop', () => {
    const sim = simulate(loopDoc())
    expect(near(sim.edges.get('e1')!, frac(120), 1e-3)).toBe(true)
    expect(near(sim.sinks.get('k')!.achieved, frac(60), 1e-3)).toBe(true)
    expect(sim.warnings.filter((w) => w.level === 'error')).toHaveLength(0)
  })

  it('errors on a lossless merger ring', () => {
    const doc: SimDoc = {
      nodes: [
        node({ id: 's', kind: 'source', rate: 60 }),
        node({ id: 'm1', kind: 'merger' }),
        node({ id: 'm2', kind: 'merger' }),
      ],
      edges: [
        edge('e0', 's', 0, 'm1', 0),
        edge('e1', 'm1', 0, 'm2', 0),
        edge('e2', 'm2', 0, 'm1', 1),
      ],
    }
    const sim = simulate(doc)
    expect(sim.warnings.some((w) => w.level === 'error')).toBe(true)
  })
})
