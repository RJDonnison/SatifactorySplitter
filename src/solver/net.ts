import { F, frac, type Frac } from './frac'
import { minMkFor } from './gameData'
import type { NetEdge, NetNode, PortSpec } from './types'

let seq = 0
export function resetNetIds() {
  seq = 0
}
const nid = (prefix: string) => `${prefix}${++seq}`

export interface BeltEnd {
  node: string
  port: number
  rate: Frac
  tapMk: number | null
}

export class NetBuilder {
  readonly nodes: NetNode[] = []
  readonly edges: NetEdge[] = []

  source(rate: Frac): string {
    const id = nid('src')
    this.nodes.push({ id, kind: 'source', rate })
    return id
  }

  sink(target: string, rate: Frac, approximate: boolean): string {
    const id = nid('sink')
    this.nodes.push({ id, kind: 'sink', target, rate, approximate })
    return id
  }

  overflowNode(): { id: string; setRate: (r: Frac) => void } {
    const id = nid('ovf')
    const node: NetNode = { id, kind: 'overflow', rate: frac(0) }
    this.nodes.push(node)
    return { id, setRate: (r) => (node.rate = r) }
  }

  splitter(ports: PortSpec[]): string {
    const id = nid('sp')
    this.nodes.push({ id, kind: 'splitter', ports })
    return id
  }

  merger(): string {
    const id = nid('mg')
    this.nodes.push({ id, kind: 'merger' })
    return id
  }

  connect(
    src: string,
    srcPort: number,
    dst: string,
    dstPort: number,
    rate: Frac,
    tapMk: number | null = null,
  ): string {
    const id = nid('e')
    this.edges.push({
      id,
      src,
      srcPort,
      dst,
      dstPort,
      rate,
      minMk: minMkFor(rate),
      tapMk,
    })
    return id
  }

  /** Fold a list of belt ends into one with merger trees as needed. */
  mergeChain(ends: BeltEnd[]): BeltEnd {
    let frontier = [...ends]
    while (frontier.length > 1) {
      const take = frontier.length >= 3 ? 3 : 2
      const group = frontier.slice(0, take)
      const rest = frontier.slice(take)
      const mid = this.merger()
      let sum = frac(0)
      group.forEach((e, i) => {
        this.connect(e.node, e.port, mid, i, e.rate, e.tapMk)
        sum = F.add(sum, e.rate)
      })
      frontier = [...rest, { node: mid, port: 0, rate: sum, tapMk: null }]
    }
    return frontier[0]
  }

  mergeInto(ends: BeltEnd[], dst: string): void {
    if (ends.length === 0) return
    const last = this.mergeChain(ends)
    this.connect(last.node, last.port, dst, 0, last.rate, last.tapMk)
  }
}

/** Merge all input belts into a single trunk entry (multi-input support). */
export function buildTrunk(b: NetBuilder, inputRates: number[]): BeltEnd {
  const ends: BeltEnd[] = inputRates.map((r) => {
    const id = b.source(frac(r))
    return { node: id, port: 0, rate: frac(r), tapMk: null }
  })
  return b.mergeChain(ends)
}
