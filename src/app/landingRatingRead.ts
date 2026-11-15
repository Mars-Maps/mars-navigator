import type { SourcedHeights } from '../data/adapters/LayeredElevation'
import type { Classified, GeologicUnitArea, SiteBounds } from '../domain'
import { landingFavourability } from '../features/route-analysis/landingFavourability'
import { CRATER_INTERIOR_BASIS, CRATER_INTERIOR_UNITS, insideUnits, landingLattice } from '../features/route-analysis/landingLattice'
import type { LandingRatingLayer, LandingRatingRead, LandingRatingState } from './landingRatingAt'

/**
 * The read of the landing rating and the store that keeps it, with
 * what they read from handed in, so both are tested without the network.
 * `landingColours.ts` wires them to the elevation chain and the geologic map.
 */
export interface LandingRatingSources {
  elevationsAt(points: Float64Array, signal: AbortSignal): Promise<Classified<SourcedHeights>>
  unitAreas(bounds: SiteBounds, signal: AbortSignal): Promise<Classified<GeologicUnitArea[]>>
}

/**
 * The rating over `bounds` as one layer, or why there is none. A read where a model
 * failed is refused, not rated: the chain fills a failed model's ground
 * from the coarser one under it, so the answer would look whole and be the
 * wrong model's. The chain names the models it could not read
 * (`SourcedHeights.failed`); a cell with no height is refused too (the
 * global model has one everywhere).
 *
 * Without `signal` the read is not tied to anything: one the user walked
 * away from still finishes.
 */
export async function readLandingRating(
  place: { name: string; bounds: SiteBounds },
  minSpacingKm: number,
  sources: LandingRatingSources,
  signal: AbortSignal = new AbortController().signal,
): Promise<LandingRatingLayer | string> {
  const lattice = landingLattice(place.bounds, minSpacingKm)
  if (lattice === null) return `No lattice fits the ${place.name} box`
  const [heights, units] = await Promise.all([
    sources.elevationsAt(lattice.points, signal),
    sources.unitAreas(place.bounds, signal),
  ])
  if (heights.classification === 'UNAVAILABLE') return `The heights could not be read: ${heights.reason}`
  if (units.classification === 'UNAVAILABLE') return `The geologic map could not be read: ${units.reason}`
  const { cols, rows, spacingEastKm, spacingNorthKm, spacingEastKmByRow, points } = lattice
  const h = heights.value
  if (h.failed && h.failed.length > 0) {
    return `The heights could not be read from one of the elevation models (${h.failed.map((f) => f.reason).join('; ')})`
  }
  let missing = 0
  for (let i = 0; i < h.heights.length; i++) if (Number.isNaN(h.heights[i])) missing++
  if (missing > 0) return `The heights could not be read for ${missing} of ${cols * rows} cells`
  const answer = landingFavourability({
    cols,
    rows,
    spacingEastKm,
    spacingNorthKm,
    spacingEastKmByRow,
    heights: h.heights,
    model: h.sourceIndex,
    models: h.sources,
    insideCrater: insideUnits(points, units.value, CRATER_INTERIOR_UNITS),
  })
  if (!answer.ok) return answer.reason
  return {
    grid: { bounds: place.bounds, cols, rows, rating: answer.rating },
    slopeDeg: answer.slopeDeg,
    reason: answer.reason,
    method: `${answer.method}. ${CRATER_INTERIOR_BASIS}`,
  }
}

/** One layer as the whole rating. */
export function oneLayer(layer: LandingRatingLayer): LandingRatingRead {
  return { layers: [layer], method: layer.method }
}

/**
 * `top` over `under`: the rating of the ground in view (`under`, at
 * coarse cells) with a finer rating of part of it (`top`, the site's sheet)
 * laid over. A cell of `under` that lies wholly under `top`'s rated ground
 * is left with no rating, so one piece of ground is never rated twice at
 * two cell sizes. `top`'s outermost cells never have a rating (the slope
 * needs the ground on every side), so a cell of `under` that reaches them
 * is kept: it is what colours that ring, and the scene cuts it where `top`
 * has a colour. `under` is not changed.
 */
export function layeredRating(top: LandingRatingLayer, under: LandingRatingLayer, topName: string): LandingRatingRead {
  const { bounds, cols, rows } = under.grid
  const rating = under.grid.rating.slice()
  const b = top.grid.bounds
  // `top`'s box less its outermost ring of cells.
  const ringLat = (b.north - b.south) / top.grid.rows
  const ringLon = (b.east - b.west) / top.grid.cols
  const inner = { south: b.south + ringLat, north: b.north - ringLat, west: b.west + ringLon, east: b.east - ringLon }
  const dLat = (bounds.north - bounds.south) / rows
  const dLon = (bounds.east - bounds.west) / cols
  for (let r = 0; r < rows; r++) {
    const north = bounds.north - r * dLat
    if (north > inner.north || north - dLat < inner.south) continue
    for (let c = 0; c < cols; c++) {
      const west = bounds.west + c * dLon
      if (west >= inner.west && west + dLon <= inner.east) rating[r * cols + c] = 0
    }
  }
  return {
    layers: [top, { ...under, grid: { ...under.grid, rating } }],
    method: `Over ${topName}: ${top.method}. Over the rest of the ground in view, at larger cells: ${under.method}`,
  }
}

/** What the store is asked to show: a read, and the key that tells one ask from the next. */
export interface LandingRatingAsk {
  /** Two asks with one key are one read. */
  key: string
}

export interface LandingRatingStore<A extends LandingRatingAsk> {
  subscribe(listener: () => void): () => void
  snapshot(): LandingRatingState
  /**
   * Shows the rating for `ask`. Nothing happens when that is what is shown
   * or being read; a failed read is not kept, so asking again tries again.
   * A read for another ask is cancelled, and the rating on show stays until
   * the new one is in: the colours belong to their own ground wherever the
   * camera has gone, so they are right while they wait to be replaced.
   */
  show(ask: A): void
}

/** One read at a time, the last ask's. */
export function createLandingRatingStore<A extends LandingRatingAsk>(
  read: (ask: A, signal: AbortSignal) => Promise<LandingRatingRead | string>,
): LandingRatingStore<A> {
  let state: LandingRatingState = { status: 'loading' }
  /** The key of the rating in `state`, when it is ready. */
  let shown: string | null = null
  let reading: { key: string; controller: AbortController } | null = null
  const listeners = new Set<() => void>()
  const publish = (next: LandingRatingState) => {
    state = next
    for (const l of listeners) l()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => state,
    show(ask) {
      if (reading ? reading.key === ask.key : shown === ask.key && state.status === 'ready') return
      reading?.controller.abort()
      const mine = { key: ask.key, controller: new AbortController() }
      reading = mine
      if (state.status === 'failed') publish({ status: 'loading' })
      void read(ask, mine.controller.signal)
        .catch((e: unknown) => `The landing rating failed: ${e instanceof Error ? e.message : String(e)}`)
        .then((result) => {
          // A newer ask owns the store: this answer is for ground no longer asked about.
          if (reading !== mine) return
          reading = null
          shown = typeof result === 'string' ? null : ask.key
          publish(typeof result === 'string' ? { status: 'failed', reason: result } : { status: 'ready', ...result })
        })
    },
  }
}
