import { F, frac, type Frac } from './frac'

/** Conveyor belt throughput per Mark, in items per minute. */
export const BELT_SPEEDS = [60, 120, 270, 480, 780, 1200] as const

export function speedOf(mk: number): number {
  return BELT_SPEEDS[mk - 1]
}

/** Smallest belt Mk whose throughput fits `rate`; null if even Mk.6 is too slow. */
export function minMkFor(rate: Frac): number | null {
  for (let mk = 1; mk <= BELT_SPEEDS.length; mk++) {
    if (F.cmp(frac(BELT_SPEEDS[mk - 1]), rate) >= 0) return mk
  }
  return null
}
