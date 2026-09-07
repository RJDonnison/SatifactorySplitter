import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import { orthogonalRoute } from './ortho'

export interface RoutedEdgeData extends Record<string, unknown> {
  waypoints?: { x: number; y: number }[]
  stroke?: string
  /** pre-computed label spot with the most clearance from nodes */
  labelPos?: { x: number; y: number }
}

/** polyline with rounded corners through the ELK-supplied bend points */
function roundedPath(pts: { x: number; y: number }[]): string {
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const prev = pts[i - 1]
    const next = pts[i + 1]
    const d1 = Math.hypot(p.x - prev.x, p.y - prev.y) || 1
    const d2 = Math.hypot(next.x - p.x, next.y - p.y) || 1
    const r = Math.min(8, d1 / 2, d2 / 2)
    const p1 = {
      x: p.x + ((prev.x - p.x) / d1) * r,
      y: p.y + ((prev.y - p.y) / d1) * r,
    }
    const p2 = {
      x: p.x + ((next.x - p.x) / d2) * r,
      y: p.y + ((next.y - p.y) / d2) * r,
    }
    d += ` L ${p1.x},${p1.y} Q ${p.x},${p.y} ${p2.x},${p2.y}`
  }
  d += ` L ${pts[pts.length - 1].x},${pts[pts.length - 1].y}`
  return d
}

function polylineMid(pts: { x: number; y: number }[]) {
  let total = 0
  const segs: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    segs.push(d)
    total += d
  }
  let acc = 0
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= total / 2) {
      const t = (total / 2 - acc) / (segs[i] || 1)
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      }
    }
    acc += segs[i]
  }
  return pts[pts.length - 1]
}

/** nearest point on a polyline to p — keeps labels on the belt itself */
function snapToPolyline(
  pts: { x: number; y: number }[],
  p: { x: number; y: number },
) {
  let best = pts[0]
  let bestD = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy || 1
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
    )
    const q = { x: a.x + dx * t, y: a.y + dy * t }
    const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
    if (dd < bestD) {
      bestD = dd
      best = q
    }
  }
  return best
}

/** total endpoint drift (px) beyond which the route is treated as stale (node dragged) */
const REANCHOR_TOLERANCE = 64

/**
 * Edge that follows the orthogonal route computed by ELK (which steers around
 * nodes). The stored waypoints are anchored on node borders while React Flow
 * reports handle centers slightly outside, and slot ranks may drift by one
 * position between layout passes — so the first and last waypoints are simply
 * re-anchored to the live handle positions. Only a large drift (a dragged
 * node) falls back to React Flow's smoothstep.
 */
export function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
}: EdgeProps) {
  const d = data as RoutedEdgeData | undefined
  const wp = d?.waypoints

  let path: string
  let labelAt = {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  }

  if (wp && wp.length >= 2) {
    const startDrift = Math.hypot(wp[0].x - sourceX, wp[0].y - sourceY)
    const endDrift = Math.hypot(
      wp[wp.length - 1].x - targetX,
      wp[wp.length - 1].y - targetY,
    )
    if (startDrift + endDrift <= REANCHOR_TOLERANCE) {
      const cleaned = orthogonalRoute(
        wp,
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      )
      path = roundedPath(cleaned)
      labelAt = d?.labelPos
        ? snapToPolyline(cleaned, d.labelPos)
        : polylineMid(cleaned)
    } else {
      const [smooth, lx, ly] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 10,
      })
      path = smooth
      labelAt = { x: lx, y: ly }
    }
  } else {
    const [smooth, lx, ly] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 10,
    })
    path = smooth
    labelAt = { x: lx, y: ly }
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: d?.stroke ?? '#52525b', strokeWidth: 2 }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)`,
              color: '#a1a1aa',
              fontSize: 10,
              background: '#09090b',
              borderRadius: 4,
              padding: '2px 5px',
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
