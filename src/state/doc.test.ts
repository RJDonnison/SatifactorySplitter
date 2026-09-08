import { describe, expect, it } from 'vitest'
import { solve } from '../solver/solve'
import {
  addNode,
  canConnect,
  connectEdge,
  inPorts,
  mapDocToFlow,
  moveNode,
  newMerger,
  newSink,
  newSource,
  newSplitter,
  newValve,
  outPorts,
  removeNodes,
  snapshotDoc,
  type NetDoc,
} from './doc'

const makeDoc = (): NetDoc => ({
  nodes: [
    newSource(0, 0),
    newSplitter(3, 100, 0),
    newMerger(200, 0),
    newSink(300, 0),
    newValve(400, 0),
  ],
  edges: [],
})

describe('doc — port model', () => {
  it('exposes the right port counts per kind', () => {
    const d = makeDoc()
    const [src, sp, mg, snk, vl] = d.nodes
    expect(outPorts(src)).toBe(1)
    expect(inPorts(src)).toBe(0)
    expect(outPorts(sp)).toBe(3)
    expect(inPorts(sp)).toBe(1)
    expect(outPorts(mg)).toBe(1)
    expect(inPorts(mg)).toBe(3)
    expect(outPorts(snk)).toBe(0)
    expect(inPorts(snk)).toBe(1)
    expect(outPorts(vl)).toBe(1)
    expect(inPorts(vl)).toBe(1)
  })
})

describe('doc — canConnect', () => {
  it('accepts an output port into a free input port', () => {
    const d = makeDoc()
    const [src, sp] = d.nodes
    expect(canConnect(d, src.id, 0, sp.id, 0)).toBe(true)
  })

  it('rejects self-loops, reversed directions, and out-of-range ports', () => {
    const d = makeDoc()
    const [src, sp, mg, snk, vl] = d.nodes
    expect(canConnect(d, src.id, 0, src.id, 0)).toBe(false)
    // into an output-only node / out of an input-only node
    expect(canConnect(d, snk.id, 0, sp.id, 0)).toBe(false)
    expect(canConnect(d, sp.id, 0, src.id, 0)).toBe(false)
    // port indices beyond the node's port count
    expect(canConnect(d, src.id, 1, sp.id, 0)).toBe(false)
    expect(canConnect(d, src.id, 0, sp.id, 1)).toBe(false)
    expect(canConnect(d, src.id, 0, mg.id, 3)).toBe(false)
    // the valve can feed onward
    expect(canConnect(d, vl.id, 0, mg.id, 2)).toBe(true)
  })

  it('rejects a second belt on an occupied port', () => {
    let d = makeDoc()
    const [a, , , snk] = d.nodes
    d = connectEdge(d, a.id, 0, snk.id, 0)
    const other = addNode(d, newSource(0, 200))
    expect(canConnect(other, other.nodes.at(-1)!.id, 0, snk.id, 0)).toBe(false)
    expect(canConnect(other, a.id, 0, other.nodes.at(-1)!.id, 0)).toBe(false)
  })
})

describe('doc — transforms', () => {
  it('connectEdge appends an edge', () => {
    const d = makeDoc()
    const [src, sp] = d.nodes
    const out = connectEdge(d, src.id, 0, sp.id, 0)
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]).toMatchObject({
      src: src.id,
      srcPort: 0,
      dst: sp.id,
      dstPort: 0,
    })
  })

  it('removeNodes cascades belts touching the node', () => {
    let d = makeDoc()
    const [src, sp, mg, snk] = d.nodes
    d = connectEdge(d, src.id, 0, sp.id, 0)
    d = connectEdge(d, sp.id, 0, mg.id, 0)
    d = connectEdge(d, mg.id, 0, snk.id, 0)
    const out = removeNodes(d, [sp.id])
    expect(out.nodes).toHaveLength(d.nodes.length - 1)
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0].dst).toBe(snk.id)
  })

  it('moveNode updates only that node position', () => {
    const d = makeDoc()
    const out = moveNode(d, d.nodes[1].id, 123, 45)
    expect(out.nodes[1]).toMatchObject({ x: 123, y: 45 })
    expect(out.nodes[0]).toEqual(d.nodes[0])
  })
})

describe('doc — snapshot & render mapping', () => {
  it('snapshots a solved layout with finite positions and valid ports', async () => {
    const sol = solve({
      inputs: [780],
      outputs: [
        { id: 'o1', rate: 60 },
        { id: 'o2', rate: 15 },
        { id: 'o3', rate: 15 },
        { id: 'o4', rate: 150 },
      ],
      tolerance: 0.01,
    })
    const doc = await snapshotDoc(sol)
    expect(doc.nodes.length).toBeGreaterThan(0)
    expect(doc.edges.length).toBeGreaterThan(0)
    const byId = new Map(doc.nodes.map((n) => [n.id, n]))
    for (const n of doc.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
    }
    for (const e of doc.edges) {
      const a = byId.get(e.src)
      const b = byId.get(e.dst)
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      expect(e.srcPort).toBeLessThan(outPorts(a!))
      expect(e.dstPort).toBeLessThan(inPorts(b!))
    }
  })

  it('maps the doc onto flow nodes with port handles', () => {
    const d = makeDoc()
    const flow = mapDocToFlow(d)
    expect(flow.nodes).toHaveLength(5)
    for (const n of flow.nodes) expect(n.position).toBeDefined()
    let doc2 = connectEdge(d, d.nodes[0].id, 0, d.nodes[1].id, 0)
    doc2 = connectEdge(doc2, doc2.nodes[1].id, 2, doc2.nodes[3].id, 0)
    const flow2 = mapDocToFlow(doc2)
    expect(flow2.edges.map((e) => e.sourceHandle)).toEqual(['p0', 'p2'])
    expect(flow2.edges.map((e) => e.targetHandle)).toEqual(['p0', 'p0'])
  })

  it('maps an unsolvable problem to a blank canvas', async () => {
    const doc = await snapshotDoc(
      solve({
        inputs: [60],
        outputs: [{ id: 'x', rate: 120 }],
        tolerance: 0.01,
      }),
    )
    expect(doc).toEqual({ nodes: [], edges: [] })
  })
})
