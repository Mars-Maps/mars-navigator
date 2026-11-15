import type { DemExtent } from './demSources'

/**
 * Where a coordinate falls on an equirectangular DEM grid. Pure
 * arithmetic, shared by the point lookup and the grid sampler.
 *
 * The USGS DEMs are pixel-is-area: cell (0, 0) spans 180°W to 180°W + 1/ppd
 * and 90°N down to 90°N − 1/ppd, so a cell's centre is half a cell in from
 * its corner. Longitude comes in as the project's 0–360°E and is converted
 * here to the file's −180…180; the conversion lives nowhere else.
 *
 * A regional grid is the same projection laid out in metres from a
 * corner. Its frame is turned into degrees here, and a point outside it has
 * no cell (null): a site model never answers for ground it does not cover.
 */

export interface DemGrid {
  widthPx: number
  heightPx: number
  /** Absent means global, as for the grids written without one. */
  extent?: DemExtent
}

/** Pixels per degree; the same in both axes for a global equirectangular file. */
export function pixelsPerDegree(grid: DemGrid): number {
  return grid.widthPx / 360
}

/** 0–360°E → −180…180 east. 180°E maps to −180: the same meridian, the file's first column. */
export function toLongitude180(longitudeEast: number): number {
  return longitudeEast >= 180 ? longitudeEast - 360 : longitudeEast
}

function wrapColumn(col: number, width: number): number {
  return ((col % width) + width) % width
}

const DEG_PER_RAD = 180 / Math.PI

/** A regional grid's frame in degrees: its west and north edges and one cell's size. */
interface RegionalFrame {
  west: number
  north: number
  cellDeg: number
}

function regionalFrame(extent: Extract<DemExtent, { kind: 'regional' }>): RegionalFrame {
  // On the sphere x = R·λ and y = R·φ, so metres over R are radians.
  return {
    west: (extent.westM / extent.radiusM) * DEG_PER_RAD,
    north: (extent.northM / extent.radiusM) * DEG_PER_RAD,
    cellDeg: (extent.cellM / extent.radiusM) * DEG_PER_RAD,
  }
}

/**
 * One cell's size in degrees, the same in latitude and longitude: both kinds
 * of grid are equirectangular at standard parallel 0. A lattice stepped by
 * this lands on each cell once, whatever radius its own distances are on.
 */
export function cellDegrees(grid: DemGrid): number {
  return grid.extent?.kind === 'regional' ? regionalFrame(grid.extent).cellDeg : 1 / pixelsPerDegree(grid)
}

/** Fractional (column, row) of a coordinate on a regional grid, from its outer corner. */
function regionalPosition(frame: RegionalFrame, latitude: number, longitudeEast: number) {
  return {
    x: (toLongitude180(longitudeEast) - frame.west) / frame.cellDeg,
    y: (frame.north - latitude) / frame.cellDeg,
  }
}

/** Whether `grid` has a cell at the coordinate. Always true for a global grid. */
export function gridCovers(grid: DemGrid, latitude: number, longitudeEast: number): boolean {
  if (grid.extent?.kind !== 'regional') return true
  const { x, y } = regionalPosition(regionalFrame(grid.extent), latitude, longitudeEast)
  return x >= 0 && x < grid.widthPx && y >= 0 && y < grid.heightPx
}

/**
 * Metres from the coordinate to the nearest edge of a regional grid, inside
 * it; null outside it or for a global grid, which has no edge.
 */
export function edgeDistanceM(grid: DemGrid, latitude: number, longitudeEast: number): number | null {
  if (grid.extent?.kind !== 'regional' || !gridCovers(grid, latitude, longitudeEast)) return null
  const { x, y } = regionalPosition(regionalFrame(grid.extent), latitude, longitudeEast)
  return Math.min(x, grid.widthPx - x, y, grid.heightPx - y) * grid.extent.cellM
}

export interface NearestCell {
  row: number
  col: number
}

/**
 * The cell a coordinate lies in: nearest-pixel, no interpolation. On a
 * global grid rows clamp at the poles; on a regional grid a point outside
 * has no cell.
 */
export function nearestCell(grid: DemGrid, latitude: number, longitudeEast: number): NearestCell | null {
  if (grid.extent?.kind === 'regional') {
    if (!gridCovers(grid, latitude, longitudeEast)) return null
    const { x, y } = regionalPosition(regionalFrame(grid.extent), latitude, longitudeEast)
    return { row: Math.floor(y), col: Math.floor(x) }
  }
  const ppd = pixelsPerDegree(grid)
  const row = Math.min(grid.heightPx - 1, Math.max(0, Math.floor((90 - latitude) * ppd)))
  const col = wrapColumn(Math.floor((toLongitude180(longitudeEast) + 180) * ppd), grid.widthPx)
  return { row, col }
}

export interface BilinearCells {
  /** The upper row and its weight partner below it. */
  r0: number
  r1: number
  /** The left column and the one east of it, wrapped at the seam. */
  c0: number
  c1: number
  /** Fraction towards c1 and towards r1. */
  tx: number
  ty: number
}

/** `v` clamped to the cell centres of an axis `size` cells long, as a fraction. */
function clampCentre(v: number, size: number): number {
  return Math.min(size - 1, Math.max(0, v))
}

/**
 * The four cell centres around a coordinate and the fractions between them.
 * At a pole the two rows are the same edge row, so the value is the edge
 * row's, never extrapolated; at the seam c1 wraps to column 0. On a
 * regional grid the outermost half cell takes the edge cell's value the
 * same way, and a point outside has no cells (null).
 */
export function bilinearCells(grid: DemGrid, latitude: number, longitudeEast: number): BilinearCells | null {
  if (grid.extent?.kind === 'regional') {
    if (!gridCovers(grid, latitude, longitudeEast)) return null
    const { x, y } = regionalPosition(regionalFrame(grid.extent), latitude, longitudeEast)
    const fc = clampCentre(x - 0.5, grid.widthPx)
    const fr = clampCentre(y - 0.5, grid.heightPx)
    const c0 = Math.floor(fc)
    const r0 = Math.floor(fr)
    return {
      r0,
      r1: Math.min(grid.heightPx - 1, r0 + 1),
      c0,
      c1: Math.min(grid.widthPx - 1, c0 + 1),
      tx: fc - c0,
      ty: fr - r0,
    }
  }
  const ppd = pixelsPerDegree(grid)
  const fc = (toLongitude180(longitudeEast) + 180) * ppd - 0.5
  const c0 = Math.floor(fc)
  const fr = Math.min(grid.heightPx - 1, Math.max(0, (90 - latitude) * ppd - 0.5))
  const r0 = Math.floor(fr)
  return {
    r0,
    r1: Math.min(grid.heightPx - 1, r0 + 1),
    c0: wrapColumn(c0, grid.widthPx),
    c1: wrapColumn(c0 + 1, grid.widthPx),
    tx: fc - c0,
    ty: fr - r0,
  }
}
