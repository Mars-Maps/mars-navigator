import { MARS_MEAN_RADIUS_KM, derived, unavailable, type Classified, type MarsCoordinate } from '../../domain'
import type { TerrainProfileCorners } from './terrainProfile'

/**
 * Where the Terrain Profile 3D tool samples the ground: a lattice over
 * the box around its four corners, in a local frame of km east and north of
 * the first corner, each node marked inside or outside the quadrilateral.
 * The shell reads heights at the nodes through the elevation chain and
 * `terrainSurface` pairs them back, holes kept as holes. Pure: no heights
 * are read here.
 */

/**
 * The most nodes along one side: 48 × 48 is 2,304 heights. The Jezero 1 m
 * model is read row by row, one request per lattice row, and no adapter
 * takes a read over 4,096 chunks at once, so the cap keeps one plot to a
 * few dozen requests and well inside the budget.
 */
export const TERRAIN_GRID_MAX_SIDE = 48

/** Fewest nodes along a side: two make an edge to draw. */
const MIN_SIDE = 2

/** A box thinner than this (1 µm) has no area to plot. */
const ZERO_EXTENT_KM = 1e-9

/** Why a valid region still has no grid. */
export const TERRAIN_GRID_REASONS = {
  noArea: 'The corners lie on one line in the east–north frame, so the region has no area to plot',
} as const

export interface TerrainGridNode {
  coordinate: MarsCoordinate
  /** Km east of the first corner. */
  xKm: number
  /** Km north of the first corner. */
  yKm: number
  /** Inside the quadrilateral, its edges included; the nodes outside fill the box and can be faded. */
  inside: boolean
}

/** A point in the local frame, km east and north of the first corner. */
export interface PlanePoint {
  x: number
  y: number
}

/**
 * The local frame the grid is laid in: equirectangular about `origin`, the
 * first corner, with east scaled by `kmPerDegEast`. Anything drawn on the
 * plot, a route for one, goes through `planePoint` with this frame.
 */
export interface PlaneFrame {
  origin: MarsCoordinate
  /** Km per degree of longitude at the box's middle latitude. */
  kmPerDegEast: number
}

export interface TerrainProfileGrid {
  /** The frame the km below are measured in. */
  frame: PlaneFrame
  /** Nodes along x (east) and along y (north). */
  columns: number
  rows: number
  /** Row-major from the south-west: `nodes[row * columns + column]`, rows northward, columns eastward. */
  nodes: TerrainGridNode[]
  /** Node spacing, km. */
  spacingKm: PlanePoint
  /** The box's size, km. */
  sizeKm: PlanePoint
  /** The box's south-west node, km from the first corner. */
  originKm: PlanePoint
  /** The corners in the local frame, in the order set. */
  cornersKm: readonly PlanePoint[]
}

export interface TerrainGridOptions {
  /** The elevation source's cell size, km: a lattice finer than this reads the same cells twice. */
  cellKm?: number
  maxSide?: number
}

const RAD = Math.PI / 180
const KM_PER_DEG = MARS_MEAN_RADIUS_KM * RAD

/**
 * The lattice over four valid corners (`terrainProfileState` ready), before
 * any height is read. The frame is equirectangular about the first corner,
 * with east scaled by the cosine of the box's middle latitude; over the few
 * kilometres a plot covers that is straight to within metres. The lattice
 * samples about every `cellKm` up to `maxSide` nodes a side, so a small
 * region gets the model's own cells and a large one is thinned, never
 * sharpened. DERIVED, with the lattice and the frame as its method.
 * UNAVAILABLE when the corners have no area in the frame (one parallel).
 */
export function terrainProfileGrid(
  corners: TerrainProfileCorners,
  { cellKm = 0, maxSide = TERRAIN_GRID_MAX_SIDE }: TerrainGridOptions = {},
): Classified<TerrainProfileGrid> {
  const first = corners[0]
  const south = Math.min(...corners.map((c) => c.latitude))
  const north = Math.max(...corners.map((c) => c.latitude))
  const frame: PlaneFrame = { origin: first, kmPerDegEast: KM_PER_DEG * Math.cos(((south + north) / 2) * RAD) }
  const { kmPerDegEast } = frame
  const cornersKm = corners.map((c) => planePoint(frame, c))
  const west = Math.min(...cornersKm.map((p) => p.x))
  const east = Math.max(...cornersKm.map((p) => p.x))
  const sizeKm = { x: east - west, y: (north - south) * KM_PER_DEG }
  if (sizeKm.x < ZERO_EXTENT_KM || sizeKm.y < ZERO_EXTENT_KM) return unavailable(TERRAIN_GRID_REASONS.noArea)

  const columns = sideCount(sizeKm.x, cellKm, maxSide)
  const rows = sideCount(sizeKm.y, cellKm, maxSide)
  const spacingKm = { x: sizeKm.x / (columns - 1), y: sizeKm.y / (rows - 1) }
  const originKm = { x: west, y: (south - first.latitude) * KM_PER_DEG }

  const nodes: TerrainGridNode[] = []
  for (let r = 0; r < rows; r++) {
    // The last row and column land on the box's edge exactly, not a float short of it.
    const yKm = r === rows - 1 ? originKm.y + sizeKm.y : originKm.y + r * spacingKm.y
    for (let c = 0; c < columns; c++) {
      const xKm = c === columns - 1 ? east : west + c * spacingKm.x
      nodes.push({
        coordinate: {
          latitude: first.latitude + yKm / KM_PER_DEG,
          longitudeEast: normalise(first.longitudeEast + xKm / kmPerDegEast),
        },
        xKm,
        yKm,
        inside: insideQuadrilateral({ x: xKm, y: yKm }, cornersKm),
      })
    }
  }
  return derived(
    { frame, columns, rows, nodes, spacingKm, sizeKm, originKm, cornersKm },
    `${columns} × ${rows} nodes about every ${describeKm(spacingKm.x)} east and ${describeKm(spacingKm.y)} north over the box around the four corners, ` +
      `in a flat frame of km east and north of the first corner (equirectangular about it, east scaled by the cosine of the box's middle latitude)`,
  )
}

/** A coordinate in the grid's frame: km east (the short way round) and north of the first corner. */
export function planePoint(frame: PlaneFrame, c: MarsCoordinate): PlanePoint {
  return {
    x: unwrap(c.longitudeEast - frame.origin.longitudeEast) * frame.kmPerDegEast,
    y: (c.latitude - frame.origin.latitude) * KM_PER_DEG,
  }
}

/** Nodes along a side of `sizeKm`: one per cell, at least two, at most `maxSide`. */
function sideCount(sizeKm: number, cellKm: number, maxSide: number): number {
  const byCell = cellKm > 0 ? Math.round(sizeKm / cellKm) + 1 : maxSide
  return Math.max(MIN_SIDE, Math.min(Math.max(MIN_SIDE, maxSide), byCell))
}

/** The nodes' coordinates as (latitude, longitude °E) pairs, the shape the elevation source reads. */
export function gridPointPairs(grid: TerrainProfileGrid): Float64Array {
  const pairs = new Float64Array(grid.nodes.length * 2)
  grid.nodes.forEach((n, i) => {
    pairs[i * 2] = n.coordinate.latitude
    pairs[i * 2 + 1] = n.coordinate.longitudeEast
  })
  return pairs
}

/** One model of the heights' source, as the elevation chain names it. */
export interface GridHeightModel {
  /** Its short product name, for the caption. */
  label: string
  /** Its provenance line, for the method. */
  source: string
  cellKm: number
}

/** Heights read at the grid's nodes, each with the model it came from; NaN where none has one. */
export interface SourcedGridHeights {
  heights: Float32Array
  sourceIndex: ArrayLike<number>
  sources: readonly GridHeightModel[]
}

/** How many heights each model gave, in chain order, for the provenance line; models that gave none are left out. */
export interface ModelShare {
  model: GridHeightModel
  count: number
}

/** The ground between the corners, ready to draw. */
export interface TerrainSurface {
  grid: TerrainProfileGrid
  /** One per node, in node order: the ground's height, metres, or NaN for a hole. */
  heightsM: Float32Array
  /** Where each height came from. */
  shares: ModelShare[]
  /** Nodes with no height. */
  holes: number
  /** The lowest and highest heights read. */
  rangeM: { min: number; max: number }
}

/**
 * The surface from a grid and the heights read at its nodes, one per node
 * in order. A NaN, the chain's mark for no data, stays a hole: never
 * zero, never a neighbour's value. An UNAVAILABLE grid or read passes its
 * reason through; a read of the wrong length is refused, not misaligned;
 * a read with no height at all is UNAVAILABLE with `noDataReason`. DERIVED:
 * the grid's method, then the models that answered.
 */
export function terrainSurface(
  grid: Classified<TerrainProfileGrid>,
  read: Classified<SourcedGridHeights>,
  noDataReason: string,
): Classified<TerrainSurface> {
  if (grid.classification === 'UNAVAILABLE') return grid
  if (read.classification === 'UNAVAILABLE') return read
  const { heights, sourceIndex, sources } = read.value
  const count = grid.value.nodes.length
  if (heights.length !== count) {
    return unavailable(`The elevation source answered ${heights.length} heights for ${count} nodes`)
  }
  const counts = new Array<number>(sources.length).fill(0)
  let holes = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < count; i++) {
    const h = heights[i]
    if (Number.isNaN(h)) {
      holes++
      continue
    }
    const k = sourceIndex[i]
    if (k >= 0 && k < counts.length) counts[k]++
    if (h < min) min = h
    if (h > max) max = h
  }
  if (holes === count) return unavailable(noDataReason)
  const shares = sources.map((model, k) => ({ model, count: counts[k] })).filter((s) => s.count > 0)
  const gridMethod = grid.classification === 'DERIVED' ? grid.method : grid.source
  const from = shares.map((s) => `${s.count} from the ${s.model.label}`).join(', ')
  const sourceLines = shares.map((s) => s.model.source).join('; ')
  return derived(
    { grid: grid.value, heightsM: Float32Array.from(heights), shares, holes, rangeM: { min, max } },
    `${gridMethod}; each height is the nearest cell of the finest model with data there: ${from}` +
      (holes > 0 ? `; ${holes} ${holes === 1 ? 'node has' : 'nodes have'} no height and are left as holes` : '') +
      `. Sources: ${sourceLines}`,
  )
}

/**
 * Whether `p` is inside the quadrilateral, edges included: even–odd ray
 * casting, which takes concave shapes and either winding, with a point on
 * an edge counted in so the corners themselves are inside.
 */
export function insideQuadrilateral(p: PlanePoint, corners: readonly PlanePoint[]): boolean {
  const n = corners.length
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = corners[j]
    const b = corners[i]
    if (onSegment(p, a, b)) return true
    if (a.y > p.y !== b.y > p.y) {
      const xAtY = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)
      if (p.x < xAtY) inside = !inside
    }
  }
  return inside
}

/** Within a micrometre of the segment a–b. */
function onSegment(p: PlanePoint, a: PlanePoint, b: PlanePoint): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < ZERO_EXTENT_KM
}

/** A longitude difference the short way round, in (−180, 180]. */
function unwrap(deltaDeg: number): number {
  const d = ((((deltaDeg + 180) % 360) + 360) % 360) - 180
  return d === -180 ? 180 : d
}

/** The longitude in [0, 360): 360°E is 0°E, and −0 is 0. */
function normalise(longitudeEast: number): number {
  const lon = ((longitudeEast % 360) + 360) % 360
  return lon === 0 ? 0 : lon
}

function describeKm(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`
  if (km >= 1) return `${km.toFixed(1)} km`
  return `${(km * 1000).toFixed(0)} m`
}
