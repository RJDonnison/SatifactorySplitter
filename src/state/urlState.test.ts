import { describe, expect, it } from 'vitest'
import { decodeDoc, decodeProblem, encodeDoc, encodeProblem } from './urlState'
import type { Problem } from './store'
import type { NetDoc } from './doc'

const problem = (maxMk: number): Problem => ({
  inputs: [{ id: 'a', rate: 780, mk: 5 }],
  outputs: [
    { id: 'b', rate: 180, mk: null },
    { id: 'c', rate: 600, mk: null },
  ],
  tolerance: 0.01,
  maxMk,
})

describe('urlState', () => {
  it('round-trips the max belt Mk', () => {
    const back = decodeProblem(encodeProblem(problem(4)))
    expect(back).not.toBeNull()
    expect(back!.maxMk).toBe(4)
    expect(back!.inputs[0].rate).toBe(780)
    expect(back!.outputs.map((o) => o.rate)).toEqual([180, 600])
    expect(back!.tolerance).toBe(0.01)
  })

  it('defaults to Mk.6 for legacy links without the field', () => {
    const legacy = btoa(JSON.stringify({ i: [780], o: [390, 390], t: 0.01 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const back = decodeProblem(legacy)
    expect(back).not.toBeNull()
    expect(back!.maxMk).toBe(6)
  })

  it('rejects garbage payloads', () => {
    expect(decodeProblem('not-base64!!')).toBeNull()
  })

  it('round-trips a manual layout doc', () => {
    const doc: NetDoc = {
      nodes: [
        { id: 'a', kind: 'source', rate: 780, x: 10, y: 20 },
        {
          id: 'b',
          kind: 'splitter',
          ports: [{ limited: true, mk: 2 }, { limited: false }],
          x: 30.5,
          y: 40,
        },
        { id: 'c', kind: 'merger', x: 50, y: 60 },
        { id: 'd', kind: 'sink', label: 'Output 1', rate: 150, x: 70, y: 80 },
        { id: 'e', kind: 'overflow', x: 90, y: 100 },
      ],
      edges: [
        { id: 'e1', src: 'a', srcPort: 0, dst: 'b', dstPort: 0, mk: null },
        { id: 'e2', src: 'b', srcPort: 0, dst: 'd', dstPort: 0, mk: 3 },
        { id: 'e3', src: 'b', srcPort: 1, dst: 'c', dstPort: 2, mk: null },
      ],
    }
    const back = decodeDoc(encodeDoc(doc))
    expect(back).not.toBeNull()
    expect(back!.nodes.map((n) => n.kind)).toEqual([
      'source',
      'splitter',
      'merger',
      'sink',
      'overflow',
    ])
    expect(back!.nodes[0].kind === 'source' && back!.nodes[0].rate).toBe(780)
    expect(back!.nodes[1].kind === 'splitter' && back!.nodes[1].ports).toEqual([
      { limited: true, mk: 2 },
      { limited: false },
    ])
    expect(back!.nodes[3]).toMatchObject({ label: 'Output 1', rate: 150 })
    // endpoints survive the index round-trip (ids are regenerated)
    expect(
      back!.edges.map((e) => [e.src, e.srcPort, e.dst, e.dstPort, e.mk]),
    ).toEqual([
      ['u0', 0, 'u1', 0, null],
      ['u1', 0, 'u3', 0, 3],
      ['u1', 1, 'u2', 2, null],
    ])
  })

  it('caps hostile layouts at 200 nodes', () => {
    const doc: NetDoc = {
      nodes: Array.from({ length: 201 }, (_, i) => ({
        id: `n${i}`,
        kind: 'overflow' as const,
        x: i,
        y: i,
      })),
      edges: [],
    }
    expect(decodeDoc(encodeDoc(doc))).toBeNull()
  })

  it('rejects malformed layouts', () => {
    // four splitter ports
    expect(decodeDoc({ nd: [[3, 0, 0, [0, 0, 0, 0]]], ed: [] })).toBeNull()
    // self-loop
    expect(decodeDoc({ nd: [[0, 0, 0, 60]], ed: [[0, 0, 0, 0, 0]] })).toBeNull()
    // same source port claimed twice
    const oneIn = {
      nd: [
        [0, 0, 0, 60],
        [1, 100, 0, 30, 'k'],
      ],
    }
    expect(
      decodeDoc({
        ...oneIn,
        ed: [
          [0, 0, 1, 0, 0],
          [0, 0, 1, 0, 0],
        ],
      }),
    ).toBeNull()
    // port out of range (a source has one output port)
    expect(decodeDoc({ ...oneIn, ed: [[0, 1, 1, 0, 0]] })).toBeNull()
  })
})
