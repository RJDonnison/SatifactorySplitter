import { create } from 'zustand'
import type { NetDoc } from './doc'
import { readStateFromUrl } from './urlState'

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
  /** 'auto' renders the solver layout; 'manual' edits the doc */
  mode: 'auto' | 'manual'
  /** parked while in auto mode — restored when editing resumes */
  doc: NetDoc | null
  enterManual: (doc: NetDoc) => void
  exitManual: () => void
  /** the single mutator for manual edits (keeps undo/redo cheap later) */
  applyDoc: (fn: (doc: NetDoc) => NetDoc) => void
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

/** initial state: a shared link (?s=) restores the problem, and a manual
 * layout section (n) additionally restores editing mode + the doc */
const initial = readStateFromUrl()
const initialProblem: Problem = initial.problem ?? defaultProblem

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
  mode: initial.manual ? 'manual' : 'auto',
  doc: initial.doc,
  enterManual: (doc) => set({ mode: 'manual', doc }),
  exitManual: () => set({ mode: 'auto' }),
  applyDoc: (fn) => set((s) => (s.doc ? { doc: fn(s.doc) } : {})),
}))
