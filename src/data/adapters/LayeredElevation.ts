import { derived, official, unavailable, type Classified, type MarsCoordinate } from '../../domain'
import { cellDegrees, edgeDistanceM, gridCovers } from '../elevation/demGrid'
import type { DemElevationAdapter } from './ElevationAdapter'

/**
 * Heights from several DEMs, finest first: the Jezero HiRISE 1 m and
 * CTX 20 m models, then the global 200 m DEM. A height comes from the first
 * model that has data at the point, so the site gets its fine cells and
 * everywhere else, and the site models' own gaps, get the global ones. All
 * share the MOLA areoid datum, so heights from two models
 * can sit side by side in one profile.
 */

/** One model of the chain, as a reader of its heights needs it. */
export interface HeightModel {
  /** Its short product name, for a caption: "CTX DTM mosaic of Jezero, 20 m". */
  label: string
  /** Its provenance line. */
  source: string
  /** Its cell size, km. */
  cellKm: number
  /**
   * A regional model of one site (DemExtent `regional`), built to one control
   * net with the site's other models, so their heights can sit in one slope
   * kernel; the global model is not.
   */
  site: boolean
}

/** The model a terrain search samples along a leg (`searchGridAlong`). */
export interface SearchGrid {
  /** Its cell size, km; 0 when no model can be searched. */
  cellKm: number
  /**
   * The same cell in degrees, of latitude and of longitude; 0 when no model
   * can be searched. The products state `cellKm` on the Mars 2000 sphere
   * (3,396.19 km) and distances here are on the mean radius, so a lattice
   * stepped by `cellKm` would be 1.002 cells apart and skip a cell every 507.
   */
  cellDeg: number
  /** Read whole, so any number of points costs no request; else one row-range request per lattice row. */
  readsWhole: boolean
}

/** A model that could not be read: its index among the read's models, and "label: reason". */
export interface FailedModel {
  model: number
  reason: string
}

/** Heights with the model each came from. */
export interface SourcedHeights {
  /** NaN where no model has a height. */
  heights: Float32Array
  /** Index into `sources` per height; meaningless where the height is NaN. */
  sourceIndex: Uint8Array
  /** Each model, in chain order: provenance and cell size on one object, so they cannot drift apart. */
  sources: HeightModel[]
  /**
   * The models that cover a point asked for and could not be read: the index
   * into `sources` and "label: reason". A NaN height may then be a failed
   * read, not ground no model covers; absent when every model asked answered.
   */
  failed?: readonly FailedModel[]
}

/**
 * How far in from a site model's edge a surface patch blends it into the
 * model under it. The Jezero CTX 20 m model and the global DEM differ
 * by 13 m typically and up to 72 m near the CTX box's edge (measured
 * 2026-10-28): spread over 2 km by a smoothstep, whose steepest point is
 * 1.5 times its average, that adds at most about 3° of slope.
 */
const BLEND_M = 2000

export class LayeredElevation {
  private readonly chain: readonly DemElevationAdapter[]
  private readonly blendM: number

  /** `chain` finest first; the last should be global, so every point has a model to ask. */
  constructor(chain: readonly DemElevationAdapter[], options: { blendM?: number } = {}) {
    if (chain.length === 0 || chain.length > 255) throw new Error('A chain needs 1 to 255 models')
    this.chain = chain
    this.blendM = options.blendM ?? BLEND_M
  }

  /** Starts every model's layout check; with `whole`, also fetches each model read whole. */
  prepare(whole = false): void {
    for (const adapter of this.chain) void adapter.prepare(whole)
  }

  /** One line naming the models in order, for a method text. */
  get description(): string {
    return `nearest cell of the finest elevation model with data at the point: ${this.chain.map((a) => a.source.label).join(', then ')}`
  }

  /** Why a point has no height at all. */
  get noDataReason(): string {
    return `No height here: no elevation model has data at this point (${this.chain.map((a) => a.source.label).join('; ')})`
  }

  /**
   * The cell size, km, a profile of `path` should sample at: the coarsest
   * among the finest models whose grids hold each vertex. A path inside the
   * HiRISE box is sampled metres apart; one that leaves Jezero, at the
   * global DEM's 200 m, so its cells are not read many times over.
   */
  cellKmAlong(path: readonly MarsCoordinate[]): number {
    let cellKm = 0
    for (const c of path) {
      const model = this.chain.find((a) => gridCovers(a.source, c.latitude, c.longitudeEast)) ?? this.chain.at(-1)
      if (model) cellKm = Math.max(cellKm, model.source.cellKm)
    }
    return cellKm > 0 ? cellKm : (this.chain.at(-1)?.source.cellKm ?? 0)
  }

  /**
   * Nearest-cell heights for (latitude, longitude °E) pairs, each from the
   * finest model with data there. A model that cannot be read is skipped,
   * so a failed site file degrades to the global DEM rather than to
   * nothing. UNAVAILABLE only when cancelled, or when not one height came
   * back from any model.
   *
   * With `onFirst`, when a slow model (a large site file read row by
   * row, one request per sample) covers some point, a first answer from the
   * fast models alone is passed to it before the slow reads finish; the
   * returned promise is the full answer. Each height still names its model.
   * A first answer that is UNAVAILABLE is not passed on.
   */
  async elevationsAt(
    points: Float64Array,
    signal: AbortSignal,
    onFirst?: (first: Classified<SourcedHeights>) => void,
  ): Promise<Classified<SourcedHeights>> {
    if (points.length % 2 !== 0) return unavailable('Points must be (latitude, longitude) pairs')
    if (onFirst && this.chain.some((a) => this.isSlow(a) && this.coversAny(a, points))) {
      const first = await this.read(points, signal, (a) => !this.isSlow(a))
      if (signal.aborted) return unavailable('Cancelled')
      // A failed fast pass is not shown: the full answer may still succeed.
      if (first.classification !== 'UNAVAILABLE') onFirst(first)
    }
    return this.read(points, signal, () => true)
  }

  /**
   * Nearest-cell heights for a terrain search, which reads by
   * the tens of thousands of points: every model but a slow one (a site
   * file read row by row, one request per sample), so the site model read
   * whole answers inside its box and the global DEM, read by row ranges,
   * everywhere else; and no model finer than `minCellKm`, so a search at the
   * global cell is answered by the global model alone. NaN where no such
   * model has a height.
   */
  async searchElevationsAt(points: Float64Array, signal: AbortSignal, minCellKm = 0): Promise<Classified<SourcedHeights>> {
    if (points.length % 2 !== 0) return unavailable('Points must be (latitude, longitude) pairs')
    return this.read(points, signal, (a) => !this.isSlow(a) && a.source.cellKm >= minCellKm)
  }

  /**
   * The grid a search of `path` runs on: the coarsest model
   * `searchElevationsAt` answers from along it, its cell size and whether
   * it is read whole (so a search box costs no requests) or by row ranges
   * (one request per lattice row). A path inside the Jezero CTX box is the
   * 20 m model read whole; one that leaves it, the global 200 m model.
   */
  searchGridAlong(path: readonly MarsCoordinate[]): SearchGrid {
    let coarsest: DemElevationAdapter | undefined
    for (const c of path) {
      const model = this.chain.find((a) => !this.isSlow(a) && gridCovers(a.source, c.latitude, c.longitudeEast))
      if (model && (!coarsest || model.source.cellKm > coarsest.source.cellKm)) coarsest = model
    }
    return coarsest
      ? { cellKm: coarsest.source.cellKm, cellDeg: cellDegrees(coarsest.source), readsWhole: coarsest.readsWhole }
      : { cellKm: 0, cellDeg: 0, readsWhole: false }
  }

  private isSlow(adapter: DemElevationAdapter): boolean {
    return adapter.source.extent.kind === 'regional' && !adapter.readsWhole
  }

  private coversAny(adapter: DemElevationAdapter, points: Float64Array): boolean {
    for (let i = 0; i < points.length; i += 2) {
      if (gridCovers(adapter.source, points[i], points[i + 1])) return true
    }
    return false
  }

  /** The chain's answer using only the models `include` accepts. */
  private async read(
    points: Float64Array,
    signal: AbortSignal,
    include: (adapter: DemElevationAdapter) => boolean,
  ): Promise<Classified<SourcedHeights>> {
    const count = points.length / 2
    const heights = new Float32Array(count).fill(Number.NaN)
    const sourceIndex = new Uint8Array(count)
    let remaining = Array.from({ length: count }, (_, i) => i)
    let lastFailure: string | null = null
    const failed: FailedModel[] = []
    for (let k = 0; k < this.chain.length && remaining.length > 0; k++) {
      const adapter = this.chain[k]
      if (!include(adapter)) continue
      const asked = remaining.filter((i) => gridCovers(adapter.source, points[i * 2], points[i * 2 + 1]))
      if (asked.length === 0) continue
      const subset = new Float64Array(asked.length * 2)
      asked.forEach((i, j) => {
        subset[j * 2] = points[i * 2]
        subset[j * 2 + 1] = points[i * 2 + 1]
      })
      const read = await adapter.elevationsAt(subset, signal)
      if (signal.aborted) return unavailable('Cancelled')
      if (read.classification === 'UNAVAILABLE') {
        lastFailure = read.reason
        failed.push({ model: k, reason: `${adapter.source.label}: ${read.reason}` })
        continue
      }
      asked.forEach((i, j) => {
        const h = read.value[j]
        if (!Number.isNaN(h)) {
          heights[i] = h
          sourceIndex[i] = k
        }
      })
      remaining = remaining.filter((i) => Number.isNaN(heights[i]))
    }
    if (remaining.length === count && lastFailure !== null) return unavailable(lastFailure)
    const sources = this.chain.map(heightModel)
    return official(failed.length > 0 ? { heights, sourceIndex, sources, failed } : { heights, sourceIndex, sources }, this.description)
  }

  /**
   * Heights on a grid for the surface view. The finest model whose grid
   * holds every point and has data under all of them draws the patch. When
   * that is the global DEM and a site model covers part of the patch,
   * the site model's heights are blended in: wholly from `blendM`
   * inside its edge, falling smoothly to the global DEM's at the edge, so
   * the mesh has no step where they meet. Only a site model read whole is
   * used (the 1 m file, read by rows, is far finer than the mesh anyway);
   * if it has a no-data cell under the patch or cannot be read, the patch
   * is the global DEM alone, as before.
   */
  async sampleGrid(points: Float64Array, signal: AbortSignal): Promise<Classified<Float32Array>> {
    let last: Classified<Float32Array> = unavailable('No elevation model in the chain')
    for (const adapter of this.chain) {
      if (!this.holdsAll(adapter, points)) continue
      last = await adapter.sampleGrid(points, signal)
      if (signal.aborted) return last
      if (last.classification === 'UNAVAILABLE') continue
      // A patch wholly inside a site model is that model alone. No site model is as big as a
      // patch today (CTX is 32 × 30 km, a patch 40 km); a bigger one would need blending here too,
      // or a patch inside it would not match its blended neighbour where they overlap.
      return adapter.source.extent.kind === 'regional' ? last : this.blendSite(points, last, adapter, signal)
    }
    return last
  }

  /** `base` with the first usable site model blended in where it covers the patch; `base` itself if none can be. */
  private async blendSite(
    points: Float64Array,
    base: Exclude<Classified<Float32Array>, { classification: 'UNAVAILABLE' }>,
    baseAdapter: DemElevationAdapter,
    signal: AbortSignal,
  ): Promise<Classified<Float32Array>> {
    for (const site of this.chain) {
      if (site === baseAdapter || site.source.extent.kind !== 'regional' || this.isSlow(site)) continue
      const inside: number[] = []
      for (let i = 0; i < points.length / 2; i++) {
        if (gridCovers(site.source, points[i * 2], points[i * 2 + 1])) inside.push(i)
      }
      if (inside.length === 0) continue
      const subset = new Float64Array(inside.flatMap((i) => [points[i * 2], points[i * 2 + 1]]))
      const read = await site.sampleGrid(subset, signal)
      if (signal.aborted) return unavailable('Cancelled')
      if (read.classification === 'UNAVAILABLE') continue
      const heights = Float32Array.from(base.value)
      inside.forEach((i, j) => {
        const t = Math.min(1, (edgeDistanceM(site.source, points[i * 2], points[i * 2 + 1]) ?? 0) / this.blendM)
        const w = t * t * (3 - 2 * t)
        heights[i] = w * read.value[j] + (1 - w) * base.value[i]
      })
      const baseMethod = base.classification === 'DERIVED' ? base.method : base.source
      return derived(
        heights,
        `Inside the site model's box: ${site.gridMethod.replace(/\.?$/, '.')} Blended into the ${baseAdapter.source.label} over ` +
          `the last ${this.blendM / 1000} km to the box's edge, by a smoothstep weight on the distance from the edge, so ` +
          `the ground has no step there. Elsewhere: ${baseMethod}`,
      )
    }
    return base
  }

  /** One nearest-cell height, from the finest model with data at the point. */
  async elevationAt(coordinate: MarsCoordinate, signal: AbortSignal): Promise<Classified<number>> {
    let last: Classified<number> = unavailable('No elevation model in the chain')
    for (const adapter of this.chain) {
      if (!gridCovers(adapter.source, coordinate.latitude, coordinate.longitudeEast)) continue
      last = await adapter.elevationAt(coordinate, signal)
      if (signal.aborted || last.classification !== 'UNAVAILABLE') return last
    }
    return last
  }

  private holdsAll(adapter: DemElevationAdapter, points: Float64Array): boolean {
    for (let i = 0; i < points.length; i += 2) {
      if (!gridCovers(adapter.source, points[i], points[i + 1])) return false
    }
    return true
  }
}

/** The model as `SourcedHeights.sources` carries it. */
function heightModel(adapter: DemElevationAdapter): HeightModel {
  return {
    label: adapter.source.label,
    source: adapter.pointSource,
    cellKm: adapter.source.cellKm,
    site: adapter.source.extent.kind === 'regional',
  }
}
