import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Solution } from '../solver/types'
import { layoutSolution, type SolutionNodeType } from './layout'
import { nodeTypes } from './NodeViews'
import { RoutedEdge } from './RoutedEdge'

const edgeTypes = { routed: RoutedEdge }

export function Diagram({ solution }: { solution: Solution }) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas solution={solution} />
    </ReactFlowProvider>
  )
}

function DiagramCanvas({ solution }: { solution: Solution }) {
  const [nodes, setNodes] = useState<SolutionNodeType[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const { fitView } = useReactFlow()

  const onNodesChange = useCallback(
    (changes: NodeChange<SolutionNodeType>[]) =>
      setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  )

  // when the user stops dragging a node, re-slot splitter outputs and merger
  // inputs by the new vertical order so belts keep fanning out without
  // crossing each other
  const onNodeDragStop = useCallback(() => {
    setNodes((nds) => {
      const nodeById = new Map(nds.map((n) => [n.id, n]))
      const yById = new Map(nds.map((n) => [n.id, n.position.y]))
      // current visual slot (fraction of node height) of each handle, so
      // belts from the same splitter can be ordered by where they leave
      const slotFrac = (nodeId: string, port: number) => {
        const n = nodeById.get(nodeId)
        if (!n) return 0.5
        if (n.type === 'splitter') {
          const p = n.data.ports.find((q) => q.port === port)
          return p ? parseFloat(p.top) / 100 : 0.5
        }
        if (n.type === 'merger') {
          const t = n.data.inputTops?.[port]
          return t ? parseFloat(t) / 100 : 0.5
        }
        return 0.5
      }
      const outBy = new Map<string, { port: number; y: number }[]>()
      const inBy = new Map<string, { port: number; y: number }[]>()
      for (const e of edges) {
        const srcPort = Number(String(e.sourceHandle ?? 'p0').slice(1))
        const dstPort = Number(String(e.targetHandle ?? 'p0').slice(1))
        const o = outBy.get(e.source) ?? []
        o.push({
          port: srcPort,
          y: (yById.get(e.target) ?? 0) + slotFrac(e.target, dstPort) * 96,
        })
        outBy.set(e.source, o)
        const i = inBy.get(e.target) ?? []
        i.push({
          port: dstPort,
          y: (yById.get(e.source) ?? 0) + slotFrac(e.source, srcPort) * 96,
        })
        inBy.set(e.target, i)
      }
      return nds.map((n) => {
        if (n.type === 'splitter') {
          const outs = (outBy.get(n.id) ?? [])
            .slice()
            .sort((a, b) => a.y - b.y || a.port - b.port)
          if (outs.length === 0) return n
          const topByPort = new Map(
            outs.map(
              (o, r) =>
                [
                  o.port,
                  `${(((r + 1) / (outs.length + 1)) * 100).toFixed(2)}%`,
                ] as const,
            ),
          )
          const ports = n.data.ports
            .map((p) => ({ ...p, top: topByPort.get(p.port) ?? p.top }))
            .sort((a, b) => parseFloat(a.top) - parseFloat(b.top))
          return { ...n, data: { ...n.data, ports } }
        }
        if (n.type === 'merger') {
          const ins = (inBy.get(n.id) ?? [])
            .slice()
            .sort((a, b) => a.y - b.y || a.port - b.port)
          if (ins.length === 0) return n
          // spread the used inputs evenly over the node height
          const topByPort = new Map(
            ins.map(
              (i, r) =>
                [
                  i.port,
                  `${(((r + 1) / (ins.length + 1)) * 100).toFixed(2)}%`,
                ] as const,
            ),
          )
          const maxPort = Math.max(...ins.map((i) => i.port))
          const inputTops = Array.from(
            { length: maxPort + 1 },
            (_, p) => topByPort.get(p) ?? n.data.inputTops?.[p] ?? '50%',
          )
          return { ...n, data: { ...n.data, inputTops } }
        }
        return n
      })
    })
  }, [edges])

  useEffect(() => {
    let cancelled = false
    layoutSolution(solution).then(({ nodes, edges }) => {
      if (cancelled) return
      setNodes(nodes)
      setEdges(edges)
      requestAnimationFrame(() => fitView({ padding: 0.25, duration: 400 }))
    })
    return () => {
      cancelled = true
    }
  }, [solution, fitView])

  if (!solution.ok) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {solution.warnings.find((w) => w.level === 'error')?.text ??
            'Cannot solve this layout.'}
        </div>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable
      nodesConnectable={false}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={28} color="#27272a" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  )
}
