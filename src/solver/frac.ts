/** Exact rational arithmetic (items/min values are frequently non-integers). */
export interface Frac {
  readonly n: bigint
  readonly d: bigint
}

const abs = (a: bigint) => (a < 0n ? -a : a)
const gcd = (a: bigint, b: bigint): bigint =>
  b === 0n ? abs(a) : gcd(b, a % b)

export function frac(n: bigint | number, d: bigint | number = 1n): Frac {
  let nn = typeof n === 'number' ? BigInt(Math.round(n)) : n
  let dd = typeof d === 'number' ? BigInt(Math.round(d)) : d
  if (dd === 0n) throw new Error('frac: zero denominator')
  if (dd < 0n) {
    nn = -nn
    dd = -dd
  }
  const g = gcd(nn, dd) || 1n
  return { n: nn / g, d: dd / g }
}

export const F = {
  add: (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d),
  div: (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n),
  cmp: (a: Frac, b: Frac): number => {
    const l = a.n * b.d
    const r = b.n * a.d
    return l < r ? -1 : l > r ? 1 : 0
  },
  eq: (a: Frac, b: Frac) => a.n === b.n && a.d === b.d,
  isZero: (a: Frac) => a.n === 0n,
  isInt: (a: Frac) => a.d === 1n,
  toNumber: (a: Frac) => Number(a.n) / Number(a.d),
}

export function formatFrac(f: Frac, digits = 1): string {
  const v = F.toNumber(f)
  return Number.isInteger(v) ? String(v) : v.toFixed(digits)
}
