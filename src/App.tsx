import { useEffect, useMemo } from 'react'
import { useStore } from './state/store'
import { solve } from './solver/solve'
import { Diagram } from './diagram/Diagram'
import { IOEditor } from './components/IOEditor'
import { Warnings } from './components/Warnings'
import { Summary } from './components/Summary'
import { writeProblemToUrl } from './state/urlState'

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

export default function App() {
  const inputs = useStore((s) => s.inputs)
  const outputs = useStore((s) => s.outputs)
  const tolerance = useStore((s) => s.tolerance)

  // keep the URL in sync so a refresh or copy keeps the current problem
  // (initial state itself is restored from ?s= in the store)
  useEffect(() => {
    writeProblemToUrl({ inputs, outputs, tolerance })
  }, [inputs, outputs, tolerance])

  const solution = useMemo(
    () =>
      solve({
        inputs: inputs.map((i) => i.rate),
        outputs: outputs.map((o) => ({ id: o.id, rate: o.rate })),
        tolerance,
      }),
    [inputs, outputs, tolerance],
  )

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            SF<span className="text-amber-400">/</span>Splitter
          </h1>
          <p className="hidden text-sm text-zinc-400 sm:block">
            Satisfactory splitter &amp; belt planner
          </p>
        </div>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
        >
          <GitHubIcon />
          GitHub
        </a>
      </header>

      <main className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 p-4 lg:flex">
          <IOEditor />
          <Warnings solution={solution} />
        </aside>
        <section className="relative min-w-0 flex-1 bg-zinc-950">
          <Diagram solution={solution} />
        </section>
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-800 p-4 xl:flex">
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
