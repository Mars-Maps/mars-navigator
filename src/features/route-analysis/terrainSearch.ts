import {
  MARS_MEAN_RADIUS_KM,
  derived,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type MarsCoordinate,
  type SiteBounds,
} from '../../domain'
import { OBSTACLE_KINDS, segmentCrossing } from './mappedObstacles'
import type { SlopeModel } from './pointSlope'
import { MinHeap } from './minHeap'
import { tangentPlane, type Xy } from './scienceGoals'
import type { WalkHeights } from './walkLegs'

/**
 * The cost-weighted path between two stops over the elevation model along
 * them: A* on an 8-connected lattice at
 * the model's own cell size, or a whole multiple of it on a long leg, each
 * step costed by the strategy from its length and slope.
 * Shared by every strategy that routes on terrain; the fastest route costs
 * a step in hours, the energy-efficient route in kilocalories.
 *
 * The lattice is the coarsest model the chain searches along the leg:
 * the site model inside its box, the global 200 m model elsewhere,
 * coarsened to a whole number of cells when the leg's box would hold more
 * nodes than the budget, which the method states. A node with no height is
 * never walked on, so a stop where no model has ground is UNAVAILABLE.
 * Mapped lines a walker cannot cross (`OBSTACLE_KINDS.lines`) block the
 * steps that cross them; when the map cannot be read, or does not cover
 * the leg, the search goes on and says so, as `walkLegs` does.
 */

/** The model a search samples along a leg: its cell size, and whether it costs a request per lattice row. */
export interface SearchGrid {
  /** Its cell size, km; 0 when no model can be searched. */
  cellKm: number
  /**
   * The same cell in degrees, of latitude and of longitude. The lattice steps
   * by this, so each node is one model cell on from the last whatever sphere
   * the product states its cell on; absent, it steps `cellKm` on the mean sphere.
   */
  cellDeg?: number
  /** Read whole, so any number of nodes costs no request; else one row-range request per lattice row. */
  readsWhole: boolean
}

/** What the search reads. The shell builds it from the elevation chain and the geology adapter. */
export interface SearchTerrain {
  /** The coarsest model the heights come from along a leg. */
  grid: (path: readonly MarsCoordinate[]) => SearchGrid
  /**
   * Nearest-cell heights from the models no finer than `cellKm`, each with
   * the model that answered; NaN where none has one. A lattice at the
   * global cell is walked on the global model alone: a 20 m point every
   * 200 m would add aliasing, not detail, and a step between two models
   * would read their offset (13 m typically, 72 m at the CTX edge) as ground.
   */
  heights: (points: Float64Array, signal: AbortSignal, cellKm: number) => ReturnType<WalkHeights>
  /** The map's features in a box; UNAVAILABLE when the map could not be read. */
  obstacles: (bounds: SiteBounds, signal: AbortSignal) => Promise<Classified<GeologicFeatures>>
}

/**
 * The cost of one step of `distanceKm` along the ground (rise included) at
 * gradient `s`, rise over run, uphill positive. Infinity for a step that
 * cannot be walked.
 */
export type StepCost = (distanceKm: number, s: number) => number

export interface SearchOptions {
  cost: StepCost
  /** A lower bound on the cost per km of any step, so the heuristic never overestimates. */
  minCostPerKm: number
  /** What `cost` refuses, in the UI's words, for the reason when no path exists. */
  blocked: string
  /** The most lattice nodes one leg's box may hold. */
  maxCells?: number
}

export interface SearchNode {
  coordinate: MarsCoordinate
  /** The nearest cell's height, metres. */
  heightM: number
  /** Index into `SearchedLeg.models`. */
  model: number
}

/** One step of a found path, for pricing it by any model. */
export interface SearchStep {
  /** Along the ground, rise included, km. */
  km: number
  /** Rise over run, uphill positive; 0 on the joins. */
  s: number
}

export interface SearchedLeg {
  /** The departure, the lattice nodes where the path turns, the destination. */
  nodes: SearchNode[]
  /**
   * The departure, every lattice node of the path in order, the destination:
   * the ends of `steps`. For what must look at each step (the hazard scans),
   * where `nodes` would average a straight run into one stretch.
   */
  walked: SearchNode[]
  /** Every step in order: the join from the departure, each lattice step, the join to the destination. */
  steps: readonly SearchStep[]
  /** Along the ground, every lattice step and the two short joins to the stops, km: the sum of `steps`. */
  distanceKm: number
  /** The sum of the step costs, in the cost's unit: what the search minimised, for a caller checking its answer. */
  cost: number
  models: readonly SlopeModel[]
  /** The lattice spacing north–south, km: the model's cell, or a whole multiple of it on a long leg. */
  spacingKm: number
  /** Whether the map's lines were kept off the path, or why they could not be. */
  /** The map's features in the leg's box when it was read, for a scan of what the path still meets. */
  obstacles: { checked: true; features: GeologicFeatures } | { checked: false; reason: string }
  /** How the path was found, for a DERIVED method. */
  method: string
}

/** Nodes per leg on a model read whole: about 15 km square at 20 m cells, searched in well under a second. */
export const MAX_SEARCH_CELLS = 600_000
/** Nodes per leg on a model read by row ranges, with the row cap below: under ten seconds (a 228 km leg at 160k nodes took 21 s). */
export const MAX_RANGE_READ_CELLS = 60_000
/** Lattice rows per leg on a model read by row ranges: about one request each (a row wider than a chunk costs more), whatever the row's width. */
export const MAX_RANGE_READ_ROWS = 250
/** The most the plane's east–west scale may be off at a leg's box edges, cos(latitude) / cos(midpoint latitude) − 1, before the leg is refused. */
export const PLANE_STRETCH_LIMIT = 0.05
/** Nearer a pole than this the tangent plane is not usable, so a leg ending there is refused. */
export const POLE_LIMIT_DEG = 85
/** The box round a leg: at least this, else this fraction of the leg's length, on every side. */
export const MARGIN_MIN_KM = 1
export const MARGIN_FRACTION = 0.3
/** Expansions between two yields to the event loop, so a long search never freezes the page. */
const YIELD_EVERY = 20_000

/**
 * The nodes: `cy` km apart north–south and `cx` = cy·cos φ km apart
 * east–west, the model's own cell in degrees both ways (its grid is
 * equirectangular at standard parallel 0), so each lattice column is one
 * model column and no step spans two cells of ground.
 */
interface Lattice {
  minX: number
  minY: number
  nx: number
  ny: number
  cx: number
  cy: number
}

/** Kilometres per degree of latitude in the search plane (`tangentPlane`), on the mean radius. */
const KM_PER_DEG = (MARS_MEAN_RADIUS_KM * Math.PI) / 180

/** The eight neighbours: column step, row step. */
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

export async function searchLeg(
  from: MarsCoordinate,
  to: MarsCoordinate,
  terrain: SearchTerrain,
  options: SearchOptions,
  signal: AbortSignal,
): Promise<Classified<SearchedLeg>> {
  throwIfAborted(signal)
  if (Math.abs(from.latitude) > POLE_LIMIT_DEG || Math.abs(to.latitude) > POLE_LIMIT_DEG) {
    return unavailable(`A leg ending within ${90 - POLE_LIMIT_DEG}° of a pole is not searched: the search works in a plane that is not usable there`)
  }
  const grid = terrain.grid([from, to])
  const c = grid.cellKm
  if (!(c > 0)) return unavailable('No elevation model can be searched here')
  // A lattice is at least 2 by 2, so a budget under 4 could never be met.
  const maxCells = Math.max(4, options.maxCells ?? (grid.readsWhole ? MAX_SEARCH_CELLS : MAX_RANGE_READ_CELLS))
  const maxRows = grid.readsWhole ? Number.POSITIVE_INFINITY : MAX_RANGE_READ_ROWS
  const origin = midpoint(from, to)
  const plane = tangentPlane(origin)
  const a = plane.project(from)
  const b = plane.project(to)
  const legKm = Math.hypot(b.x - a.x, b.y - a.y)
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180)
  // One model cell in the plane's own kilometres. The models state their cell
  // on the Mars 2000 sphere and the plane is on the mean radius, so `c` km
  // here is 1.002 cells: every 507th step would span two cells of ground and
  // read twice the slope.
  const stepKm = grid.cellDeg && grid.cellDeg > 0 ? grid.cellDeg * KM_PER_DEG : c
  // The margin shrinks first, then the spacing grows a whole cell at a time, until the box fits the budget.
  const fits = (lattice: Lattice) => lattice.nx * lattice.ny <= maxCells && lattice.ny <= maxRows
  let every = 1
  let L = latticeFor(a, b, stepKm * cosLat, stepKm, Math.max(MARGIN_MIN_KM, MARGIN_FRACTION * legKm))
  if (!fits(L)) L = latticeFor(a, b, stepKm * cosLat, stepKm, MARGIN_MIN_KM)
  while (!fits(L)) {
    every++
    L = latticeFor(a, b, every * stepKm * cosLat, every * stepKm, MARGIN_MIN_KM)
  }
  const n = L.nx * L.ny
  const box = boxBounds(plane, L)
  const stretch = planeStretch(box, cosLat)
  if (stretch > PLANE_STRETCH_LIMIT) {
    return unavailable(
      `The leg spans too much latitude for one search plane: east–west distances at its ends would be off by up to ${Math.round(stretch * 100)}%. Add a stop between`,
    )
  }

  const points = new Float64Array(n * 2)
  for (let k = 0; k < n; k++) {
    const p = plane.unproject(xyOf(L, k))
    points[k * 2] = p.latitude
    points[k * 2 + 1] = p.longitudeEast
  }
  const read = await terrain.heights(points, signal, c)
  throwIfAborted(signal)
  if (read.classification === 'UNAVAILABLE') return unavailable(`The elevation model could not be read: ${read.reason}`)
  const { heights: h, model, models, failed } = read.value
  if (h.length !== n || model.length !== n) {
    throw new Error(`The elevation source answered ${h.length} heights for ${n} lattice nodes`)
  }
  // Ground is a height from a model no coarser than the lattice: ten 20 m nodes
  // in one 200 m cell would read as a flat strip and then a cliff. With the
  // read above, every usable node is on the lattice's own model.
  const usable = (k: number) => !Number.isNaN(h[k]) && models[model[k]].cellKm <= c
  const start = nodeOf(L, a)
  const goal = nodeOf(L, b)
  // A stop with no usable height after a model the lattice could stand on
  // failed to read is a failed read, which a retry may mend. A coarser model
  // that failed could not have given the stop its ground, so it is not blamed.
  const failedUsable = (failed ?? []).filter((f) => models[f.model] !== undefined && models[f.model].cellKm <= c)
  const offModel = (what: string) =>
    unavailable<SearchedLeg>(
      failedUsable.length > 0
        ? `No usable height at the ${what}: an elevation model could not be read (${failedUsable.map((f) => f.reason).join('; ')})`
        : `No elevation model has a height at the ${what}, so there is no ground to search from`,
    )
  if (!usable(start)) return offModel('departure')
  if (!usable(goal)) return offModel('destination')

  const map = await terrain.obstacles(box, signal)
  throwIfAborted(signal)
  const barriers = map.classification === 'UNAVAILABLE' ? null : bucketLines(map.value, plane, L)

  // A*: g in the cost's unit, the heuristic the straight distance at the best cost per km.
  const g = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const gx = goal % L.nx
  const gy = (goal - gx) / L.nx
  const heuristic = (i: number, j: number) => Math.hypot((i - gx) * L.cx, (j - gy) * L.cy) * options.minCostPerKm
  const heap = new MinHeap()
  g[start] = 0
  heap.push(start, heuristic(start % L.nx, Math.floor(start / L.nx)))
  let expansions = 0
  while (heap.size > 0) {
    const k = heap.pop()
    if (closed[k]) continue
    closed[k] = 1
    if (k === goal) break
    if (++expansions % YIELD_EVERY === 0) {
      await yieldToEventLoop()
      throwIfAborted(signal)
    }
    const i = k % L.nx
    const j = (k - i) / L.nx
    for (const [di, dj] of DIRS) {
      const ii = i + di
      const jj = j + dj
      if (ii < 0 || jj < 0 || ii >= L.nx || jj >= L.ny) continue
      const m = jj * L.nx + ii
      if (closed[m] || !usable(m)) continue
      const run = Math.hypot(di * L.cx, dj * L.cy)
      const riseKm = (h[m] - h[k]) / 1000
      const step = options.cost(Math.hypot(run, riseKm), riseKm / run)
      if (!(step < Number.POSITIVE_INFINITY)) continue
      if (barriers !== null && crossesBarrier(barriers, L, k, m)) continue
      const tentative = g[k] + step
      if (tentative < g[m]) {
        g[m] = tentative
        came[m] = k
        heap.push(m, tentative + heuristic(ii, jj))
      }
    }
  }
  if (!closed[goal]) {
    return unavailable(
      `No path within ${describeKm((L.nx - 1) * L.cx)} by ${describeKm((L.ny - 1) * L.cy)} round the leg avoids ${options.blocked}`,
    )
  }

  const chain: number[] = []
  for (let k = goal; k !== -1; k = came[k]) chain.push(k)
  chain.reverse()
  // The stops themselves sit up to half a cell from their nodes: a short level join each.
  const joinIn = Math.hypot(a.x - xyOf(L, start).x, a.y - xyOf(L, start).y)
  const joinOut = Math.hypot(b.x - xyOf(L, goal).x, b.y - xyOf(L, goal).y)
  const steps: SearchStep[] = [{ km: joinIn, s: 0 }]
  for (let s = 1; s < chain.length; s++) {
    const p = xyOf(L, chain[s - 1])
    const q = xyOf(L, chain[s])
    const run = Math.hypot(q.x - p.x, q.y - p.y)
    const riseKm = (h[chain[s]] - h[chain[s - 1]]) / 1000
    steps.push({ km: Math.hypot(run, riseKm), s: riseKm / run })
  }
  steps.push({ km: joinOut, s: 0 })
  const distanceKm = steps.reduce((sum, step) => sum + step.km, 0)
  const cost = g[goal] + options.cost(joinIn, 0) + options.cost(joinOut, 0)

  const node = (k: number, coordinate = plane.unproject(xyOf(L, k))): SearchNode => ({
    coordinate,
    heightM: h[k],
    model: model[k],
  })
  const turns = chain.filter((k, s) => s === 0 || s === chain.length - 1 || heading(L, chain[s - 1], k) !== heading(L, k, chain[s + 1]))
  const nodes = [node(start, { ...from }), ...turns.map((k) => node(k)), node(goal, { ...to })]
  const walked = [node(start, { ...from }), ...chain.map((k) => node(k)), node(goal, { ...to })]
  const obstacles: SearchedLeg['obstacles'] =
    map.classification === 'UNAVAILABLE' ? { checked: false, reason: map.reason } : { checked: true, features: map.value }
  const spacing =
    every === 1
      ? `about one model cell apart (${describeKm(L.cy)} north–south, ${describeKm(L.cx)} east–west at this latitude)`
      : `every ${every} model cells (${describeKm(L.cy)} north–south, ${describeKm(L.cx)} east–west at this latitude; the leg is too long for a finer search), so a slope is a mean over that and steeper ground shorter than it is not seen`
  const detour = Math.round((worstDetour(L.cx, L.cy) - 1) * 100)
  const method = `A* search over an 8-connected lattice of nearest-cell heights ${spacing}, ${L.nx} by ${L.ny} nodes round the leg, in a plane tangent at the leg's midpoint; each step's length includes its rise, and each stop is joined on the level to its nearest node, whose height it is given. The lattice walks eight headings only, so on a heading between them the path zig-zags and is up to about ${detour}% longer than the straight line; the figures are of the lattice path`
  return derived({ nodes, walked, steps, distanceKm, cost, models, spacingKm: L.cy, obstacles, method }, method)
}

/** The leg's midpoint, the longitude wrapped so a leg across 0/360°E has it between the ends. */
export function midpoint(from: MarsCoordinate, to: MarsCoordinate): MarsCoordinate {
  const dLon = ((((to.longitudeEast - from.longitudeEast) % 360) + 540) % 360) - 180
  return { latitude: (from.latitude + to.latitude) / 2, longitudeEast: (((from.longitudeEast + dLon / 2) % 360) + 360) % 360 }
}

/** How far the plane's east–west scale is off at the box's south and north edges: |cos φ / cos φ₀ − 1|, the worse of the two. */
function planeStretch(box: SiteBounds, cosLat: number): number {
  const rad = Math.PI / 180
  return Math.max(Math.abs(Math.cos(box.south * rad) / cosLat - 1), Math.abs(Math.cos(box.north * rad) / cosLat - 1))
}

/**
 * The most a lattice path is longer than the straight line, over every
 * heading, as a ratio: about 1.08 on a square lattice, more as the columns
 * close up towards a pole (1.18 at 60°).
 */
function worstDetour(cx: number, cy: number): number {
  const diagonal = Math.hypot(cx, cy)
  let worst = 1
  for (let step = 0; step <= 720; step++) {
    const heading = (step * Math.PI) / 1440 // an eighth of a degree, over a quadrant
    const u = Math.cos(heading) / cx
    const v = Math.sin(heading) / cy
    const d = Math.min(u, v)
    worst = Math.max(worst, d * diagonal + (u - d) * cx + (v - d) * cy)
  }
  return worst
}

function latticeFor(a: Xy, b: Xy, cx: number, cy: number, marginKm: number): Lattice {
  const minX = Math.min(a.x, b.x) - marginKm
  const minY = Math.min(a.y, b.y) - marginKm
  const nx = Math.ceil((Math.max(a.x, b.x) + marginKm - minX) / cx) + 1
  const ny = Math.ceil((Math.max(a.y, b.y) + marginKm - minY) / cy) + 1
  return { minX, minY, nx, ny, cx, cy }
}

const xyOf = (L: Lattice, k: number): Xy => ({ x: L.minX + (k % L.nx) * L.cx, y: L.minY + Math.floor(k / L.nx) * L.cy })

/** The node nearest `p`, clamped into the lattice. */
function nodeOf(L: Lattice, p: Xy): number {
  const i = Math.min(L.nx - 1, Math.max(0, Math.round((p.x - L.minX) / L.cx)))
  const j = Math.min(L.ny - 1, Math.max(0, Math.round((p.y - L.minY) / L.cy)))
  return j * L.nx + i
}

/** The direction of the step k → m, as one number per neighbour. */
function heading(L: Lattice, k: number, m: number): number {
  const di = (m % L.nx) - (k % L.nx)
  const dj = Math.floor(m / L.nx) - Math.floor(k / L.nx)
  return di * 3 + dj
}

/** The lattice's box as the map adapter takes it. Across 0/360°E west comes out greater than east, which the map adapter answers as off its sheet, so the path says lines were not kept off. */
function boxBounds(plane: ReturnType<typeof tangentPlane>, L: Lattice): SiteBounds {
  const sw = plane.unproject(xyOf(L, 0))
  const ne = plane.unproject(xyOf(L, L.nx * L.ny - 1))
  return { west: sw.longitudeEast, east: ne.longitudeEast, south: sw.latitude, north: ne.latitude }
}

/** Segments of the map's impassable lines, by the lattice cell they run through or next to. */
interface Barriers {
  segments: [Xy, Xy][]
  byCell: Map<number, Set<number>>
}

/**
 * Every cell within one cell of a point sampled every half cell (the
 * smaller spacing) along a segment holds that segment. Any step a segment
 * crosses leaves from or arrives at one of those cells, so testing a step
 * against the segments of its two cells misses nothing; the test itself is
 * exact.
 */
function bucketLines(features: GeologicFeatures, plane: ReturnType<typeof tangentPlane>, L: Lattice): Barriers {
  const segments: [Xy, Xy][] = []
  const byCell = new Map<number, Set<number>>()
  const kinds: readonly string[] = OBSTACLE_KINDS.lines
  const maxX = L.minX + (L.nx - 1) * L.cx
  const maxY = L.minY + (L.ny - 1) * L.cy
  const half = Math.min(L.cx, L.cy) / 2
  for (const line of features.lines) {
    if (!kinds.includes(line.kind)) continue
    const pts = line.path.map(plane.project)
    for (let s = 1; s < pts.length; s++) {
      const p = pts[s - 1]
      const q = pts[s]
      if (Math.max(p.x, q.x) < L.minX - L.cx || Math.min(p.x, q.x) > maxX + L.cx) continue
      if (Math.max(p.y, q.y) < L.minY - L.cy || Math.min(p.y, q.y) > maxY + L.cy) continue
      const index = segments.push(stretched(p, q)) - 1
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / half)
      for (let t = 0; t <= steps; t++) {
        const f = steps === 0 ? 0 : t / steps
        const i = Math.round((p.x + (q.x - p.x) * f - L.minX) / L.cx)
        const j = Math.round((p.y + (q.y - p.y) * f - L.minY) / L.cy)
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            const ii = i + di
            const jj = j + dj
            if (ii < 0 || jj < 0 || ii >= L.nx || jj >= L.ny) continue
            const cell = jj * L.nx + ii
            let set = byCell.get(cell)
            if (!set) byCell.set(cell, (set = new Set()))
            set.add(index)
          }
        }
      }
    }
  }
  return { segments, byCell }
}

/** How far a step is stretched past each node before the crossing test, as a fraction of its length. */
const STEP_OVERLAP = 1e-6

/**
 * Whether the step k → m crosses a barrier. The step is stretched a little
 * past both nodes, and every barrier a millimetre past its ends, so a line
 * through a node, or ending on one, is crossed by the steps in and out of
 * it rather than slipping between them by rounding. Erring towards blocked
 * is the honest side.
 */
/** How far a barrier is stretched past each end, km: a millimetre, so an end on a node is still crossed. */
const BARRIER_OVERHANG_KM = 1e-6

function stretched(p: Xy, q: Xy): [Xy, Xy] {
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  if (len === 0) return [p, q]
  const ux = ((q.x - p.x) / len) * BARRIER_OVERHANG_KM
  const uy = ((q.y - p.y) / len) * BARRIER_OVERHANG_KM
  return [
    { x: p.x - ux, y: p.y - uy },
    { x: q.x + ux, y: q.y + uy },
  ]
}

function crossesBarrier(barriers: Barriers, L: Lattice, k: number, m: number): boolean {
  const near = barriers.byCell.get(k)
  const far = barriers.byCell.get(m)
  if (!near && !far) return false
  const p = xyOf(L, k)
  const q = xyOf(L, m)
  const a = { x: p.x - (q.x - p.x) * STEP_OVERLAP, y: p.y - (q.y - p.y) * STEP_OVERLAP }
  const b = { x: q.x + (q.x - p.x) * STEP_OVERLAP, y: q.y + (q.y - p.y) * STEP_OVERLAP }
  const test = (index: number) => segmentCrossing(a, b, barriers.segments[index][0], barriers.segments[index][1]) !== null
  if (near) for (const index of near) if (test(index)) return true
  if (far) for (const index of far) if (!near?.has(index) && test(index)) return true
  return false
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
}

export function describeKm(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`
  if (km >= 1) return `${km.toFixed(1)} km`
  return `${(km * 1000).toFixed(0)} m`
}
