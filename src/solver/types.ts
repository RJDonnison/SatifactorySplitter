import type { Frac } from './frac'

/**
 * Network IR.
 *
 * Port conventions:
 * - source: one output (srcPort 0)
 * - splitter: one input (dstPort 0); outputs srcPort 0..ports.length-1
 * - merger: up to three inputs (dstPort 0..2); one output (srcPort 0)
 * - sink / overflow: one or more inputs (dstPort 0+... merged upstream)
 */
export type PortSpec = { limited: false } | { limited: true; mk: number }

export type NetNode =
  | { id: string; kind: 'source'; rate: Frac }
  | {
      id: string
      kind: 'sink'
      target: string
      rate: Frac
      approximate: boolean
    }
  | { id: string; kind: 'overflow'; rate: Frac }
  | { id: string; kind: 'splitter'; ports: PortSpec[] }
  | { id: string; kind: 'merger' }

export interface NetEdge {
  id: string
  src: string
  srcPort: number
  dst: string
  dstPort: number
  /** steady-state flow on this edge */
  rate: Frac
  /** minimum belt tier that fits `rate`; belt tiers above also work */
  minMk: number | null
  /** set when this edge is a capacity-limited tap: the belt Mk doing the limiting */
  tapMk: number | null
}

export type WarningLevel = 'info' | 'warn' | 'error'
export interface Warning {
  level: WarningLevel
  text: string
}

export interface Solution {
  ok: boolean
  nodes: NetNode[]
  edges: NetEdge[]
  warnings: Warning[]
  inputRate: Frac
  outputIds: string[]
  buildings: { splitters: number; mergers: number }
  /** total excess belt capacity across edges (tie-break score, lower is better) */
  excess: number
  approximateCount: number
}

export interface TargetSpec {
  id: string
  rate: number
}

export interface SolveInput {
  inputs: number[]
  outputs: TargetSpec[]
  /** snap tolerance for non-constructible ratios as a fraction (0.01 = 1%) */
  tolerance: number
}
