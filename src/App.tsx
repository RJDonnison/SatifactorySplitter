import { useEffect, useMemo, useState } from 'react'
import { useStore } from './state/store'
import { snapshotDoc } from './state/doc'
import { solve } from './solver/solve'
import { Diagram } from './diagram/Diagram'
import { ManualDiagram } from './diagram/ManualDiagram'
import { IOEditor } from './components/IOEditor'
import { Warnings } from './components/Warnings'
import { Summary } from './components/Summary'
import { writeStateToUrl } from './state/urlState'

export const REPO_URL = 'https://github.com/RJDonnison/SatifactorySplitter'

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 fill-current"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

const panelToggle =
  'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors aria-expanded:border-zinc-500 aria-expanded:bg-zinc-800 aria-expanded:text-zinc-100 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'

export default function App() {
  const inputs = useStore((s) => s.inputs)
  const outputs = useStore((s) => s.outputs)
  const tolerance = useStore((s) => s.tolerance)
  const maxMk = useStore((s) => s.maxMk)
  const mode = useStore((s) => s.mode)
  const doc = useStore((s) => s.doc)
  const enterManual = useStore((s) => s.enterManual)
  const exitManual = useStore((s) => s.exitManual)

  // panels default open on roomy screens, toggleable everywhere; on small
  // screens they open as overlay drawers over the diagram
  const [showInputs, setShowInputs] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1024,
  )
  const [showSummary, setShowSummary] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1280,
  )

  // keep the URL in sync so a refresh or copy keeps the current state
  // (initial state itself is restored from ?s= in the store); manual mode
  // packs the layout doc into the same link (see urlState `n` section)
  useEffect(() => {
    writeStateToUrl({ inputs, outputs, tolerance, maxMk }, mode, doc)
  }, [inputs, outputs, tolerance, maxMk, mode, doc])

  const solution = useMemo(
    () =>
      solve({
        inputs: inputs.map((i) => i.rate),
        outputs: outputs.map((o) => ({ id: o.id, rate: o.rate })),
        tolerance,
        maxMk,
      }),
    [inputs, outputs, tolerance, maxMk],
  )

  // entering manual restores a parked doc if the user edited one earlier,
  // otherwise snapshots the layout the user sees (blank canvas when the
  // problem is unsolvable); exiting parks the doc for later
  const toggleMode = async () => {
    if (mode === 'manual') {
      exitManual()
      return
    }
    enterManual(useStore.getState().doc ?? (await snapshotDoc(solution)))
  }

  // replace the edited layout with a fresh snapshot of the solver result
  // (destructive, so it needs a confirm)
  const regenerate = async () => {
    if (
      !window.confirm(
        'Replace the current manual layout with a fresh layout from the problem?',
      )
    )
      return
    enterManual(await snapshotDoc(solution))
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-zinc-800 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-baseline gap-2 sm:gap-3">
          <h1 className="text-base font-semibold tracking-tight sm:text-lg">
            SF<span className="text-amber-400">/</span>Splitter
          </h1>
          <p className="hidden text-sm text-zinc-400 md:block">
            Satisfactory splitter &amp; belt planner
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            className={panelToggle}
            aria-expanded={mode === 'manual'}
            onClick={toggleMode}
          >
            {mode === 'manual' ? 'Done editing' : 'Edit layout'}
          </button>
          <button
            type="button"
            className={panelToggle}
            aria-expanded={showInputs}
            onClick={() => setShowInputs((v) => !v)}
          >
            Inputs
          </button>
          <button
            type="button"
            className={panelToggle}
            aria-expanded={showSummary}
            onClick={() => setShowSummary((v) => !v)}
          >
            Summary
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
          >
            <GitHubIcon />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1">
        {showInputs && (
          <div
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setShowInputs(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={`${showInputs ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-4 lg:static lg:z-auto lg:max-w-none lg:shrink-0`}
        >
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <span className="text-sm font-semibold text-zinc-300">Inputs</span>
            <button
              type="button"
              aria-label="Close inputs panel"
              onClick={() => setShowInputs(false)}
              className="rounded-lg border border-zinc-800 px-2 py-0.5 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              ×
            </button>
          </div>
          {mode === 'manual' ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-200">
                Manual editing
              </h2>
              <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-400">
                <li>Add buildings from the palette on the canvas.</li>
                <li>Drag from a port to a port to draw a belt.</li>
                <li>Select a node or belt to edit rates, taps, and belt Mk.</li>
                <li>Select and press Backspace to delete.</li>
              </ul>
              <p className="text-xs text-zinc-500">
                Belt rates and warnings update live on the canvas. Edits are
                kept when you switch back to automatic solving.
              </p>
              <button
                type="button"
                onClick={regenerate}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-amber-500 hover:text-amber-300"
              >
                Regenerate from problem…
              </button>
            </div>
          ) : (
            <>
              <IOEditor />
              <Warnings solution={solution} />
            </>
          )}
        </aside>
        <section className="relative min-w-0 flex-1 bg-zinc-950">
          {mode === 'manual' ? (
            <ManualDiagram />
          ) : (
            <Diagram solution={solution} />
          )}
        </section>
        <aside
          className={`${showSummary ? 'flex' : 'hidden'} fixed inset-y-0 right-0 z-40 w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 lg:static lg:z-auto lg:max-w-none lg:shrink-0`}
        >
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <span className="text-sm font-semibold text-zinc-300">Summary</span>
            <button
              type="button"
              aria-label="Close summary panel"
              onClick={() => setShowSummary(false)}
              className="rounded-lg border border-zinc-800 px-2 py-0.5 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              ×
            </button>
          </div>
          <Summary solution={solution} />
        </aside>
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
        <span>
          Belt speeds &amp; building behaviour per the{' '}
          <a
            href="https://satisfactory.wiki.gg"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-zinc-600 hover:text-zinc-300"
          >
            Satisfactory wiki
          </a>
          . Not affiliated with Coffee Stain Studios.
        </span>
        <span>
          AI disclosure: designed and built with AI assistance (opencode / GLM).
          See{' '}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-300"
          >
            the repo
          </a>
          .
        </span>
      </footer>
    </div>
  )
}
