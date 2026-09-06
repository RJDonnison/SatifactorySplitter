import { useEffect, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Solution } from '../solver/types'
import { layoutSolution, type SolutionNodeType } from './layout'
import { nodeTypes } from './NodeViews'

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
