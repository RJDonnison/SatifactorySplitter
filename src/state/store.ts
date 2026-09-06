import { create } from 'zustand'

export interface IOBelt {
  id: string
  /** items per minute */
  rate: number
  /** preferred belt Mk (1-6), null = any */
  mk: number | null
}

export interface Problem {
  inputs: IOBelt[]
  outputs: IOBelt[]
  /** snap tolerance for non-constructible ratios, as a fraction (0.01 = 1%) */
  tolerance: number
}

interface AppState extends Problem {
  addInput: () => void
  removeInput: (id: string) => void
  setInput: (id: string, patch: Partial<Omit<IOBelt, 'id'>>) => void
  addOutput: () => void
  removeOutput: (id: string) => void
  setOutput: (id: string, patch: Partial<Omit<IOBelt, 'id'>>) => void
  setTolerance: (t: number) => void
}

let nextId = 0
const uid = () => `io${++nextId}`

export const useStore = create<AppState>((set) => ({
  inputs: [
    { id: uid(), rate: 780, mk: 5 },
    { id: uid(), rate: 0, mk: null },
  ],
  outputs: [
    { id: uid(), rate: 390, mk: null },
    { id: uid(), rate: 390, mk: null },
  ],
  tolerance: 0.01,
  addInput: () =>
    set((s) => ({ inputs: [...s.inputs, { id: uid(), rate: 60, mk: null }] })),
  removeInput: (id) =>
    set((s) => ({ inputs: s.inputs.filter((i) => i.id !== id) })),
  setInput: (id, patch) =>
    set((s) => ({
      inputs: s.inputs.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    })),
  addOutput: () =>
    set((s) => ({
      outputs: [...s.outputs, { id: uid(), rate: 60, mk: null }],
    })),
  removeOutput: (id) =>
    set((s) => ({ outputs: s.outputs.filter((o) => o.id !== id) })),
  setOutput: (id, patch) =>
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    })),
  setTolerance: (t) => set({ tolerance: t }),
}))

export const selectProblem = (s: AppState): Problem => ({
  inputs: s.inputs,
  outputs: s.outputs,
  tolerance: s.tolerance,
})
