import type { MarsCoordinate } from '../../../domain'
import { pathInBox } from '../../route-analysis/pathInBox'
import type { PlanePoint, TerrainSurface } from '../../route-analysis/terrainProfileGrid'

/** The route sits this share of the box's longer side above the ground, so the surface does not swallow it. */
const LIFT_SHARE = 0.006

/** Samples per lattice spacing along the route, so the ribbon bends with the ground between nodes. */
const SAMPLES_PER_CELL = 2

/** A point of the route in plot space: x east, y up (exaggerated, lifted), z south, km. */
export type PlotVertex = readonly [number, number, number]

/**
 * The followed route on the Terrain Profile 3D plot: its path where
 * it crosses the box (`pathInBox`), resampled at half the lattice's spacing
 * so it follows the ground, each sample's height read on the drawn mesh's
 * own triangle (`heightAt`), exaggerated as the heightfield is and lifted a
 * little above it. A hole under a sample breaks the line, so the route is
 * never drawn over ground that has no height. Returns the route as
 * polylines of plot-space vertices, each of two points or more; empty when
 * the route never crosses the box.
 */
export function routeLines(surface: TerrainSurface, path: readonly MarsCoordinate[], exaggeration: number): PlotVertex[][] {
  const { grid, rangeM } = surface
  const { spacingKm, sizeKm } = grid
  const step = Math.min(spacingKm.x, spacingKm.y) / SAMPLES_PER_CELL
  const lift = LIFT_SHARE * Math.max(sizeKm.x, sizeKm.y)
  const scale = exaggeration / 1000
  const out: PlotVertex[][] = []
  let line: PlotVertex[] = []
  const close = () => {
    if (line.length > 1) out.push(line)
    line = []
  }
  for (const polyline of pathInBox(grid, path)) {
    for (const p of resample(polyline, step)) {
      const h = heightAt(surface, p)
      if (Number.isNaN(h)) close()
      else line.push([p.x, (h - rangeM.min) * scale + lift, -p.y])
    }
    close()
  }
  return out
}

/** Whether any of the route would be drawn: it crosses the box over ground that has a height. */
export function routeOnSurface(surface: TerrainSurface, path: readonly MarsCoordinate[]): boolean {
  return routeLines(surface, path, 1).length > 0
}

/** A ribbon's vertices and triangles, for one mesh. */
export interface RibbonArrays {
  positions: Float32Array
  indices: Uint32Array
}

/**
 * The lines as a flat ribbon `widthKm` wide, lying on the ground: two
 * vertices per sample, offset either side of the line across its direction
 * in the floor's plane (at a bend, across the mean of the two directions;
 * where the line doubles back on itself, across the step before), and two
 * triangles per step, `drop` km lower than the line. A ribbon reads at any
 * width on screen where a one-pixel line is lost in the colours.
 */
export function ribbon(lines: readonly (readonly PlotVertex[])[], widthKm: number, drop = 0): RibbonArrays {
  const positions: number[] = []
  const indices: number[] = []
  const half = widthKm / 2
  for (const line of lines) {
    const first = positions.length / 3
    let nx = 0
    let nz = 0
    for (let i = 0; i < line.length; i++) {
      const [x, y, z] = line[i]
      // The direction along the line at this sample, in the floor's plane.
      const a = line[Math.max(0, i - 1)]
      const b = line[Math.min(line.length - 1, i + 1)]
      let dx = b[0] - a[0]
      let dz = b[2] - a[2]
      if (Math.hypot(dx, dz) < 1e-12) {
        // A reversal: the neighbours coincide, so take the step before this sample.
        dx = x - a[0]
        dz = z - a[2]
      }
      const len = Math.hypot(dx, dz)
      // Across it: the direction turned a quarter turn in the plane, kept on
      // the same side as the sample before, so a line that doubles back does
      // not twist its ribbon into a bow-tie.
      if (len > 0) {
        const cx = (-dz / len) * half
        const cz = (dx / len) * half
        const flip = cx * nx + cz * nz < 0 ? -1 : 1
        nx = cx * flip
        nz = cz * flip
      }
      positions.push(x + nx, y - drop, z + nz, x - nx, y - drop, z - nz)
      if (i > 0) {
        const l = first + i * 2
        indices.push(l - 2, l - 1, l, l - 1, l + 1, l)
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** The polyline with each segment split into steps of at most `step` km, its own points kept. */
function resample(line: readonly PlanePoint[], step: number): PlanePoint[] {
  const out: PlanePoint[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 1; k <= n; k++) out.push(k === n ? b : { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  return out
}

/**
 * The drawn ground's height at a point of the frame, metres: linear on the
 * heightfield's own triangle there (two per cell on the south-west to
 * north-east diagonal, as `heightfieldArrays` cuts them), so a point on it
 * sits on the mesh exactly. NaN outside the box or when a node of that
 * triangle is a hole, where the mesh has no triangle either: no height is
 * made up next to one. A marker's height, never reported.
 */
export function heightAt(surface: TerrainSurface, p: PlanePoint): number {
  const { grid, heightsM } = surface
  const { columns, rows, originKm, spacingKm } = grid
  const fx = (p.x - originKm.x) / spacingKm.x
  const fy = (p.y - originKm.y) / spacingKm.y
  // A hair outside the box, from the clip's arithmetic, still reads the edge cell.
  if (fx < -1e-9 || fy < -1e-9 || fx > columns - 1 + 1e-9 || fy > rows - 1 + 1e-9) return Number.NaN
  const c = Math.min(columns - 2, Math.max(0, Math.floor(fx)))
  const r = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
  const u = Math.min(1, Math.max(0, fx - c))
  const v = Math.min(1, Math.max(0, fy - r))
  const sw = heightsM[r * columns + c]
  const se = heightsM[r * columns + c + 1]
  const nw = heightsM[(r + 1) * columns + c]
  const ne = heightsM[(r + 1) * columns + c + 1]
  // South-east of the diagonal: the triangle sw–se–ne; north-west: sw–ne–nw. On the diagonal, whichever is drawn.
  const southEast = sw + (se - sw) * u + (ne - se) * v
  const northWest = sw + (nw - sw) * v + (ne - nw) * u
  if (v < u || (v === u && Number.isNaN(nw))) return southEast
  return northWest
}
