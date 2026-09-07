export type Pt = { x: number; y: number }

/**
 * Bend a raw waypoint list into a strictly orthogonal, hook-free polyline
 * between the given endpoints (live handle positions). ELK anchors sit on
 * node borders while handles protrude a few pixels and slot ranks can drift
 * between passes, so endpoints are re-anchored here and every resulting
 * diagonal segment is replaced with orthogonal bends — endpoint segments get
 * a mid-x Z-route so belts always leave and enter the side handles flat.
 */
export function orthogonalRoute(raw: Pt[], src: Pt, dst: Pt): Pt[] {
  let pts: Pt[] = [src, ...raw.slice(1, -1), dst]

  // split any diagonal segment into orthogonal bends
  {
    const out: Pt[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1]
      const b = pts[i]
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
        if (a === src || b === dst) {
          const mx = (a.x + b.x) / 2
          out.push({ x: mx, y: a.y }, { x: mx, y: b.y })
        } else {
          const c = pts[i + 1]
          out.push(
            c && Math.abs(c.x - b.x) < 0.5
              ? { x: b.x, y: a.y }
              : { x: a.x, y: b.y },
          )
        }
      }
      out.push(b)
    }
    pts = out
  }

  // a vertical first/last leg (leaving a side handle up/down) is moved to the
  // first interior vertical corridor so the belt always exits flat
  if (pts.length >= 3) {
    const s = pts[0]
    if (Math.abs(s.x - pts[1].x) < 0.5 && Math.abs(s.y - pts[1].y) > 0.5) {
      const j = pts.findIndex(
        (p, k) => k >= 2 && Math.abs(p.x - pts[k - 1].x) > 0.5,
      )
      if (j > 0) pts.splice(1, j - 1, { x: pts[j].x, y: s.y })
    }
    const e = pts[pts.length - 1]
    const e1 = pts[pts.length - 2]
    if (Math.abs(e.x - e1.x) < 0.5 && Math.abs(e.y - e1.y) > 0.5) {
      for (let k = pts.length - 3; k >= 1; k--) {
        if (Math.abs(pts[k + 1].x - pts[k].x) > 0.5) {
          pts.splice(k + 1, pts.length - k - 2, { x: pts[k].x, y: e.y })
          break
        }
      }
    }
  }

  // collapse tight zigzags: a direction reversal across a short jog (up a
  // little, sideways, back down) is ELK noise — flatten it to the far
  // corridor; wider jogs are box detours (CLEAR = 16) and stay untouched
  {
    const eq = (a: number, b: number) => Math.abs(a - b) < 0.5
    let changed = true
    while (changed) {
      changed = false
      for (let i = 0; i + 3 < pts.length; i++) {
        const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]
        const d1 = Math.sign(p1.y - p0.y)
        const d2 = Math.sign(p3.y - p2.y)
        const e1 = Math.sign(p1.x - p0.x)
        const e2 = Math.sign(p3.x - p2.x)
        if (
          eq(p0.x, p1.x) &&
          eq(p1.y, p2.y) &&
          eq(p2.x, p3.x) &&
          Math.abs(p2.x - p1.x) <= 15 &&
          d1 !== 0 &&
          d1 === -d2
        ) {
          pts.splice(i + 1, 2, { x: p2.x, y: p0.y })
          changed = true
          break
        }
        if (
          eq(p0.y, p1.y) &&
          eq(p1.x, p2.x) &&
          eq(p2.y, p3.y) &&
          Math.abs(p2.y - p1.y) <= 15 &&
          e1 !== 0 &&
          e1 === -e2
        ) {
          pts.splice(i + 1, 2, { x: p0.x, y: p2.y })
          changed = true
          break
        }
      }
    }
  }

  // collapse duplicates, collinear runs and overshoot hooks (a bend that
  // reverses direction on the same axis) until the polyline is clean
  for (let pass = 0; pass < 4; pass++) {
    const out: Pt[] = [pts[0]]
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1]
      const p = pts[i]
      const b = pts[i + 1]
      const dx1 = p.x - a.x
      const dy1 = p.y - a.y
      const dx2 = b.x - p.x
      const dy2 = b.y - p.y
      const h1 = Math.abs(dy1) < 0.5
      const v1 = Math.abs(dx1) < 0.5
      const h2 = Math.abs(dy2) < 0.5
      const v2 = Math.abs(dx2) < 0.5
      if (h1 && v1) continue // duplicate point
      if (h1 && h2 && dx1 * dx2 <= 0) continue // collinear or reversal hook
      if (v1 && v2 && dy1 * dy2 <= 0) continue
      out.push(p)
    }
    out.push(pts[pts.length - 1])
    if (out.length === pts.length) {
      pts = out
      break
    }
    pts = out
  }
  return pts
}
