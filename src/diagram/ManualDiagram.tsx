import { useCallback, useEffect, useRef, useState } from 'react'
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
  type DocNode,
} from '../state/doc'
import { nodeTypes } from './NodeViews'
import type { SolutionNodeType } from './layout'

const paletteBtn =
  'rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-left text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500'

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
  const { fitView, screenToFlowPosition } = useReactFlow()
  const [nodes, setNodes] = useState<SolutionNodeType[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  // only fit when the canvas goes from empty to populated, so ordinary
  // edits never yank the viewport around
  const wasEmpty = useRef(true)

  useEffect(() => {
    const mapped = doc ? mapDocToFlow(doc) : { nodes: [], edges: [] }
    setNodes((prev) =>
      mapped.nodes.map((n) => ({
        ...n,
        selected: prev.find((p) => p.id === n.id)?.selected ?? false,
      })),
    )
    setEdges(mapped.edges)
    if (wasEmpty.current && mapped.nodes.length > 0) {
      wasEmpty.current = false
      requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300 }))
    }
    if (mapped.nodes.length === 0) wasEmpty.current = true
  }, [doc, fitView])

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

  if (!doc) return null

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
        </div>
      </Panel>
      <Background variant={BackgroundVariant.Dots} gap={28} color="#27272a" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}
