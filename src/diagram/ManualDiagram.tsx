import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { useStore } from '../state/store'
import {
  addNode,
  autoArrangeDoc,
  canConnect,
  connectEdge,
  mapDocToFlow,
  moveNode,
  newMerger,
  newSink,
  newSource,
  newSplitter,
  newValve,
  removeEdges,
  removeNodes,
  setEdgeMk,
  setNodeRate,
  setPortTap,
  setSinkLabel,
  setSplitterPorts,
  type DocNode,
} from '../state/doc'
import { simulate } from '../solver/simulate'
import { nodeTypes } from './NodeViews'
import type { SolutionNodeType } from './layout'

const paletteBtn =
  'rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500'

const fieldCls =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none'

const warnCls = (level: string) =>
  level === 'error'
    ? 'text-red-400'
    : level === 'warn'
      ? 'text-amber-300'
      : 'text-zinc-400'

export function ManualDiagram() {
  return (
    <ReactFlowProvider>
      <ManualCanvas />
    </ReactFlowProvider>
  )
}

function ManualCanvas() {
  const doc = useStore((s) => s.doc)
  const applyDoc = useStore((s) => s.applyDoc)
  const maxMk = useStore((s) => s.maxMk)
  const { fitView, screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes] = useState<SolutionNodeType[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  // only fit when the canvas goes from empty to populated, so ordinary
  // edits never yank the viewport around
  const wasEmpty = useRef(true)

  // live rates & warnings derive from the doc on every render (cheap)
  const sim = useMemo(() => (doc ? simulate(doc, maxMk) : null), [doc, maxMk])

  useEffect(() => {
    const mapped = doc ? mapDocToFlow(doc, sim) : { nodes: [], edges: [] }
    setNodes((prev) =>
      mapped.nodes.map((n) => ({
        ...n,
        selected: prev.find((p) => p.id === n.id)?.selected ?? false,
      })),
    )
    setEdges((eds) =>
      mapped.edges.map((e) => ({
        ...e,
        selected: eds.find((p) => p.id === e.id)?.selected ?? false,
      })),
    )
    if (wasEmpty.current && mapped.nodes.length > 0) {
      wasEmpty.current = false
      requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300 }))
    }
    if (mapped.nodes.length === 0) wasEmpty.current = true
  }, [doc, sim, fitView])

  const onNodesChange = useCallback(
    (changes: NodeChange<SolutionNodeType>[]) => {
      const removed = changes
        .filter((c) => c.type === 'remove')
        .map((c) => c.id)
      if (removed.length) applyDoc((d) => removeNodes(d, removed))
      setNodes((nds) =>
        applyNodeChanges(
          changes.filter((c) => c.type !== 'remove'),
          nds,
        ),
      )
    },
    [applyDoc],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes
        .filter((c) => c.type === 'remove')
        .map((c) => c.id)
      if (removed.length) applyDoc((d) => removeEdges(d, removed))
      setEdges((eds) =>
        applyEdgeChanges(
          changes.filter((c) => c.type !== 'remove'),
          eds,
        ),
      )
    },
    [applyDoc],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const srcPort = Number(String(c.sourceHandle ?? 'p0').slice(1))
      const dstPort = Number(String(c.targetHandle ?? 'p0').slice(1))
      if (!c.source || !c.target) return
      applyDoc((d) =>
        canConnect(d, c.source!, srcPort, c.target!, dstPort)
          ? connectEdge(d, c.source!, srcPort, c.target!, dstPort)
          : d,
      )
    },
    [applyDoc],
  )

  const onNodeDragStop = useCallback(
    (_: unknown, __: unknown, dragged: SolutionNodeType[]) => {
      applyDoc((d) =>
        dragged.reduce(
          (acc, n) => moveNode(acc, n.id, n.position.x, n.position.y),
          d,
        ),
      )
    },
    [applyDoc],
  )

  const add = useCallback(
    (make: (x: number, y: number) => DocNode) => {
      const p = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      applyDoc((d) => addNode(d, make(p.x, p.y)))
    },
    [applyDoc, screenToFlowPosition],
  )

  const arrange = useCallback(async () => {
    if (!doc) return
    if (
      !window.confirm(
        'Auto-arrange every node into a clean left-to-right layout? Manual positions will be lost.',
      )
    )
      return
    const arranged = await autoArrangeDoc(doc)
    applyDoc(() => arranged)
    requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300 }))
  }, [applyDoc, doc, fitView])

  if (!doc) return null

  const selNode = nodes.find((n) => n.selected) ?? null
  const selDocNode = selNode
    ? (doc.nodes.find((n) => n.id === selNode.id) ?? null)
    : null
  const selEdge = edges.find((e) => e.selected) ?? null
  const selDocEdge = selEdge
    ? (doc.edges.find((e) => e.id === selEdge.id) ?? null)
    : null

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStop={onNodeDragStop}
      snapToGrid
      snapGrid={[20, 20]}
      deleteKeyCode={['Backspace', 'Delete']}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable
      nodesConnectable
      elementsSelectable
      proOptions={{ hideAttribution: false }}
    >
      <Panel position="top-left">
        <div className="flex w-36 flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-950/90 p-2 shadow-lg shadow-black/40">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Add
          </span>
          <button
            type="button"
            className={paletteBtn}
            onClick={() => add(newSource)}
          >
            Input belt
          </button>
          <button
            type="button"
            className={paletteBtn}
            onClick={() => add(newSink)}
          >
            Output
          </button>
          <button
            type="button"
            className={paletteBtn}
            onClick={() => add(newValve)}
          >
            Overflow valve
          </button>
          <button
            type="button"
            className={paletteBtn}
            onClick={() => add((x, y) => newSplitter(2, x, y))}
          >
            Splitter · 2
          </button>
          <button
            type="button"
            className={paletteBtn}
            onClick={() => add((x, y) => newSplitter(3, x, y))}
          >
            Splitter · 3
          </button>
          <button
            type="button"
            className={paletteBtn}
            onClick={() => add(newMerger)}
          >
            Merger
          </button>
          <button type="button" className={paletteBtn} onClick={arrange}>
            Auto-arrange…
          </button>
        </div>
      </Panel>

      {(selDocNode || selDocEdge) && (
        <Panel position="top-right">
          <div
            className="flex w-52 flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 p-3 shadow-lg shadow-black/40"
            data-testid="inspector"
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              {selDocNode ? selDocNode.kind : 'belt'}
            </span>
            {selDocNode?.kind === 'source' && (
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                rate /min
                <input
                  type="number"
                  min={0}
                  max={1200}
                  className={fieldCls}
                  value={selDocNode.rate}
                  onChange={(e) =>
                    applyDoc((d) =>
                      setNodeRate(d, selDocNode.id, Number(e.target.value)),
                    )
                  }
                />
              </label>
            )}
            {selDocNode?.kind === 'sink' && (
              <>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  label
                  <input
                    type="text"
                    className={fieldCls}
                    value={selDocNode.label}
                    onChange={(e) =>
                      applyDoc((d) =>
                        setSinkLabel(d, selDocNode.id, e.target.value),
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  wants /min
                  <input
                    type="number"
                    min={0}
                    max={1200}
                    className={fieldCls}
                    value={selDocNode.rate}
                    onChange={(e) =>
                      applyDoc((d) =>
                        setNodeRate(d, selDocNode.id, Number(e.target.value)),
                      )
                    }
                  />
                </label>
              </>
            )}
            {selDocNode?.kind === 'splitter' && (
              <>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  ports
                  <select
                    className={fieldCls}
                    value={selDocNode.ports.length}
                    onChange={(e) =>
                      applyDoc((d) =>
                        setSplitterPorts(
                          d,
                          selDocNode.id,
                          Number(e.target.value) as 2 | 3,
                        ),
                      )
                    }
                  >
                    <option value={2}>2 outputs</option>
                    <option value={3}>3 outputs</option>
                  </select>
                </label>
                {selDocNode.ports.map((p, i) => (
                  <label
                    key={i}
                    className="flex flex-col gap-1 text-xs text-zinc-400"
                  >
                    port {i + 1}
                    <select
                      className={fieldCls}
                      value={p.limited ? p.mk : 0}
                      onChange={(e) =>
                        applyDoc((d) =>
                          setPortTap(
                            d,
                            selDocNode.id,
                            i,
                            Number(e.target.value) || null,
                          ),
                        )
                      }
                    >
                      <option value={0}>open split</option>
                      {[1, 2, 3, 4, 5, 6].map((m) => (
                        <option key={m} value={m}>
                          Mk.{m} tap
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            )}
            {selDocEdge && (
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                belt Mk
                <select
                  className={fieldCls}
                  value={selDocEdge.mk ?? 0}
                  onChange={(e) =>
                    applyDoc((d) =>
                      setEdgeMk(
                        d,
                        selDocEdge.id,
                        Number(e.target.value) || null,
                      ),
                    )
                  }
                >
                  <option value={0}>auto (smallest)</option>
                  {[1, 2, 3, 4, 5, 6].map((m) => (
                    <option key={m} value={m}>
                      Mk.{m}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </Panel>
      )}

      {sim && sim.warnings.length > 0 && (
        <Panel position="bottom-left">
          <ul
            className="flex max-h-44 w-72 flex-col gap-1 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/90 p-2.5 text-xs shadow-lg shadow-black/40"
            data-testid="manual-warnings"
          >
            {sim.warnings.map((w, i) => (
              <li key={i} className={warnCls(w.level)}>
                {w.text}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Background variant={BackgroundVariant.Dots} gap={28} color="#27272a" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}
