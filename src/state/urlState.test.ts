import { describe, expect, it } from 'vitest'
import { decodeProblem, encodeProblem } from './urlState'
import type { Problem } from './store'

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
})
