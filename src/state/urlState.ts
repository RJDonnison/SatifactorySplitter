import type { Problem } from './store'

interface Packed {
  i: number[]
  o: number[]
  t: number
  m?: number
}

const toB64Url = (s: string): string =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64Url = (s: string): string =>
  atob(s.replace(/-/g, '+').replace(/_/g, '/'))

export function encodeProblem(p: Problem): string {
  const packed: Packed = {
    i: p.inputs.map((b) => b.rate),
    o: p.outputs.map((b) => b.rate),
    t: p.tolerance,
    m: p.maxMk,
  }
  return toB64Url(JSON.stringify(packed))
}

export function decodeProblem(code: string): Problem | null {
  try {
    const raw = JSON.parse(fromB64Url(code)) as Partial<Packed>
    if (!Array.isArray(raw.i) || !Array.isArray(raw.o)) return null
    const pos = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0
    if (!raw.i.every(pos) || !raw.o.every(pos)) return null
    return {
      inputs: raw.i.map((rate) => ({
        id: `io${rate}-${Math.random()}`,
        rate,
        mk: null,
      })),
      outputs: raw.o.map((rate) => ({
        id: `o${rate}-${Math.random()}`,
        rate,
        mk: null,
      })),
      tolerance:
        typeof raw.t === 'number' && raw.t > 0 && raw.t <= 0.05 ? raw.t : 0.01,
      maxMk:
        typeof raw.m === 'number' && raw.m >= 1 && raw.m <= 6
          ? Math.round(raw.m)
          : 6,
    }
  } catch {
    return null
  }
}

export function readProblemFromUrl(): Problem | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('s')
  return code ? decodeProblem(code) : null
}

export function writeProblemToUrl(p: Problem): void {
  const url = new URL(window.location.href)
  url.searchParams.set('s', encodeProblem(p))
  window.history.replaceState(null, '', url.toString())
}
