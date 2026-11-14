import type { MarsCoordinate } from '../../domain'
import { planePoint, type PlanePoint, type TerrainProfileGrid } from './terrainProfileGrid'

/**
 * Where a path crosses the Terrain Profile 3D plot's box: the path's
 * points in the grid's frame, each segment clipped to the box's rectangle
 * (Liang–Barsky, edges included), chained into polylines that break where
 * the path leaves the box and start again where it comes back. Pure. An
 * empty list for a path of fewer than two points or one that never enters
 * the box. A route changes with the strategy picked, so this is cheap to
 * run again per route.
 */
export function pathInBox(grid: TerrainProfileGrid, path: readonly MarsCoordinate[]): PlanePoint[][] {
  const { originKm: o, sizeKm: s } = grid
  const box = { x0: o.x, x1: o.x + s.x, y0: o.y, y1: o.y + s.y }
  const points = path.map((c) => planePoint(grid.frame, c))
  const lines: PlanePoint[][] = []
  let open: PlanePoint[] | null = null
  const close = () => {
    if (open !== null && open.length > 1) lines.push(open)
    open = null
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const span = clipSegment(a, b, box)
    if (span === null) {
      close()
      continue
    }
    const [t0, t1] = span
    const p1 = lerp(a, b, t1)
    if (open !== null && t0 === 0) {
      push(open, p1)
    } else {
      close()
      open = [lerp(a, b, t0)]
      push(open, p1)
    }
    if (t1 < 1) close()
  }
  close()
  return lines
}

/** Whether any of `path` lies in the box. */
export function pathCrossesBox(grid: TerrainProfileGrid, path: readonly MarsCoordinate[]): boolean {
  return pathInBox(grid, path).length > 0
}

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * The part of the segment a–b inside the box, as parameters [t0, t1] along it
 * (0 at a, 1 at b), or null when none is. Liang–Barsky: each edge narrows
 * the span; a segment parallel to an edge and outside it is out at once. A
 * point on an edge counts as inside.
 */
function clipSegment(a: PlanePoint, b: PlanePoint, box: Box): [number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  // Each row: the direction's component p, and q, how far a is inside the edge.
  const edges: [number, number][] = [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return null
      if (t > t0) t0 = t
    } else {
      if (t < t0) return null
      if (t < t1) t1 = t
    }
  }
  return [t0, t1]
}

function lerp(a: PlanePoint, b: PlanePoint, t: number): PlanePoint {
  return t === 0 ? a : t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Appends `p` unless it repeats the line's last point (a zero-length step). */
function push(line: PlanePoint[], p: PlanePoint) {
  const last = line[line.length - 1]
  if (last.x !== p.x || last.y !== p.y) line.push(p)
}
