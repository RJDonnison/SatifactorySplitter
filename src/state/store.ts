import { create } from 'zustand'
import { readProblemFromUrl } from './urlState'

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
  /** highest belt Mark the design may place (input belts are exempt) */
  maxMk: number
}

interface AppState extends Problem {
  addInput: () => void
  removeInput: (id: string) => void
  setInput: (id: string, patch: Partial<Omit<IOBelt, 'id'>>) => void
  addOutput: () => void
  removeOutput: (id: string) => void
  setOutput: (id: string, patch: Partial<Omit<IOBelt, 'id'>>) => void
  setTolerance: (t: number) => void
  setMaxMk: (mk: number) => void
}

let nextId = 0
const uid = () => `io${++nextId}`

const defaultProblem: Problem = {
  inputs: [{ id: uid(), rate: 780, mk: 5 }],
  outputs: [
    { id: uid(), rate: 390, mk: null },
    { id: uid(), rate: 390, mk: null },
  ],
  tolerance: 0.01,
  maxMk: 6,
}

/** initial state: a shared problem from ?s= if present, else the default demo */
const initialProblem: Problem = readProblemFromUrl() ?? defaultProblem

export const useStore = create<AppState>((set) => ({
  inputs: initialProblem.inputs,
  outputs: initialProblem.outputs,
  tolerance: initialProblem.tolerance,
  maxMk: initialProblem.maxMk,
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
  setMaxMk: (mk) => set({ maxMk: Math.min(6, Math.max(1, Math.round(mk))) }),
}))
