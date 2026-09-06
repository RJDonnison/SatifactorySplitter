import { F, frac, formatFrac, type Frac } from './frac'
import { minMkFor, speedOf } from './gameData'
import type { PortSpec, Solution } from './types'

export interface VerifyResult {
  ok: boolean
  issues: string[]
}

/**
 * Steady-state port rates of a splitter fed `f`, applying back-pressure:
 * ports whose limiting belt is slower than the round-robin share get pinned
 * at their belt capacity; the rest divide what remains. Returns null when the
 * splitter stalls (every port limited and flow left over).
 */
export function portRates(
  f: Frac,
  ports: PortSpec[],
): (Frac | undefined)[] | null {
  const n = ports.length
  const out: (Frac | undefined)[] = new Array(n)
  let rem = f
  let open = n
  for (;;) {
    if (open === 0) return F.isZero(rem) ? out : null
    const share = F.div(rem, frac(open))
    let pinned = false
    for (let i = 0; i < n; i++) {
      if (out[i] !== undefined) continue
      const p = ports[i]
      if (p.limited && F.cmp(frac(speedOf(p.mk)), share) < 0) {
        const cap = frac(speedOf(p.mk))
        out[i] = cap
        rem = F.sub(rem, cap)
        open--
        pinned = true
      }
    }
    if (!pinned) {
      for (let i = 0; i < n; i++) if (out[i] === undefined) out[i] = share
      return out
    }
  }
}

/** Re-simulate the network and check every invariant. */
export function verify(sol: Solution, maxMk = 6): VerifyResult {
  const issues: string[] = []
  const bad = (msg: string) => issues.push(msg)
  const outs = new Map<string, typeof sol.edges>()
  const ins = new Map<string, typeof sol.edges>()
  for (const e of sol.edges) {
    if (!outs.has(e.src)) outs.set(e.src, [])
    outs.get(e.src)!.push(e)
    if (!ins.has(e.dst)) ins.set(e.dst, [])
    ins.get(e.dst)!.push(e)
  }
  const nodeById = new Map(sol.nodes.map((n) => [n.id, n]))

  for (const e of sol.edges) {
    const srcNode = nodeById.get(e.src)
    if (!srcNode || !nodeById.has(e.dst))
      bad(`edge ${e.id} references missing node`)
    const expect =
      srcNode?.kind === 'source' ? minMkFor(e.rate) : minMkFor(e.rate, maxMk)
    if (e.minMk !== expect)
      bad(`edge ${e.id} belt tier is not the minimum for its rate`)
    if (expect === null)
      bad(
        `edge ${e.id} rate ${formatFrac(e.rate)}/min exceeds the max belt Mk.${maxMk} capacity`,
      )
    if (e.tapMk !== null && !F.eq(e.rate, frac(speedOf(e.tapMk))))
      bad(`edge ${e.id} tap belt does not match its rate`)
  }

  let totalIn = frac(0)
  let totalOut = frac(0)

  for (const n of sol.nodes) {
    const o = outs.get(n.id) ?? []
    const i = ins.get(n.id) ?? []
    if (n.kind === 'source') {
      totalIn = F.add(totalIn, n.rate)
      if (o.length !== 1 || !F.eq(o[0].rate, n.rate))
        bad(`source ${n.id} has an inconsistent edge`)
    } else if (n.kind === 'splitter') {
      if (i.length !== 1) bad(`splitter ${n.id} must have exactly one input`)
      else {
        const rates = portRates(i[0].rate, n.ports)
        if (!rates)
          bad(
            `splitter ${n.id} stalls: all ports are limited and flow is left over`,
          )
        else {
          if (o.length !== n.ports.length)
            bad(`splitter ${n.id} is missing an output belt`)
          for (const e of o) {
            const expect = rates[e.srcPort]
            if (expect === undefined)
              bad(`splitter ${n.id} has a belt on unknown port ${e.srcPort}`)
            else if (!F.eq(expect, e.rate))
              bad(`splitter ${n.id} port ${e.srcPort} rate mismatch`)
            const p = n.ports[e.srcPort]
            if (p && p.limited && e.tapMk !== p.mk)
              bad(
                `splitter ${n.id} port ${e.srcPort} is not marked as a Mk.${p.mk} tap`,
              )
            if (p && !p.limited && e.tapMk !== null)
              bad(
                `splitter ${n.id} port ${e.srcPort} is marked as a tap but is not limited`,
              )
          }
        }
      }
    } else if (n.kind === 'merger') {
      if (o.length !== 1) bad(`merger ${n.id} must have exactly one output`)
      if (i.length < 1 || i.length > 3)
        bad(`merger ${n.id} has ${i.length} inputs`)
      const sum = i.reduce((acc, e) => F.add(acc, e.rate), frac(0))
      if (o.length === 1 && !F.eq(o[0].rate, sum))
        bad(`merger ${n.id} output rate mismatch`)
    } else {
      // sink / overflow
      totalOut = F.add(totalOut, n.rate)
      const sum = i.reduce((acc, e) => F.add(acc, e.rate), frac(0))
      if (i.length < 1 || !F.eq(sum, n.rate))
        bad(
          `${n.kind} ${n.id} receives ${i.length ? 'a different' : 'no'} rate than declared`,
        )
    }
  }

  if (!F.eq(totalIn, totalOut))
    bad('total in-flow does not equal total out-flow')
  return { ok: issues.length === 0, issues }
}
