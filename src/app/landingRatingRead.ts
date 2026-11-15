import type { SourcedHeights } from '../data/adapters/LayeredElevation'
import type { Classified, GeologicUnitArea, SiteBounds } from '../domain'
import { landingFavourability } from '../features/route-analysis/landingFavourability'
import { CRATER_INTERIOR_BASIS, CRATER_INTERIOR_UNITS, insideUnits, landingLattice } from '../features/route-analysis/landingLattice'
import type { LandingRatingRead, LandingRatingState } from './landingRatingAt'

/**
 * The read of the landing rating and the store that keeps it, with
 * what they read from handed in, so both are tested without the network.
 * `landingColours.ts` wires them to the elevation chain and the geologic map.
 */
export interface LandingRatingSources {
  elevationsAt(points: Float64Array, signal: AbortSignal): Promise<Classified<SourcedHeights>>
  unitAreas(bounds: SiteBounds, signal: AbortSignal): Promise<Classified<GeologicUnitArea[]>>
  /**
   * Per elevation model, in the chain's order (the order of
   * `SourcedHeights.sources`): whether the model's grid has a cell at a point.
   */
  covers: readonly ((latitude: number, longitudeEast: number) => boolean)[]
}

/**
 * The rating over `bounds`, or why there is none. A read where a model
 * failed is refused, not rated: the chain fills a failed model's ground
 * from the coarser one under it, so the answer would look whole and be the
 * wrong model's. A model that covers part of the lattice and gave no height
 * at all is taken as failed, as is any cell with no height (the global
 * model has one everywhere).
 */
export async function readLandingRating(
  place: { name: string; bounds: SiteBounds },
  minSpacingKm: number,
  sources: LandingRatingSources,
): Promise<LandingRatingRead | string> {
  const lattice = landingLattice(place.bounds, minSpacingKm)
  if (lattice === null) return `No lattice fits the ${place.name} box`
  // Not tied to the panel: a read the user walked away from still finishes and is kept.
  const signal = new AbortController().signal
  const [heights, units] = await Promise.all([
    sources.elevationsAt(lattice.points, signal),
    sources.unitAreas(place.bounds, signal),
  ])
  if (heights.classification === 'UNAVAILABLE') return `The heights could not be read: ${heights.reason}`
  if (units.classification === 'UNAVAILABLE') return `The geologic map could not be read: ${units.reason}`
  const { cols, rows, spacingEastKm, spacingNorthKm, points } = lattice
  const h = heights.value
  const answered = new Uint8Array(sources.covers.length)
  let missing = 0
  for (let i = 0; i < h.heights.length; i++) {
    if (Number.isNaN(h.heights[i])) missing++
    else if (h.sourceIndex[i] < answered.length) answered[h.sourceIndex[i]] = 1
  }
  if (missing > 0) return `The heights could not be read for ${missing} of ${cols * rows} cells`
  for (let k = 0; k < sources.covers.length; k++) {
    if (answered[k]) continue
    for (let i = 0; i < points.length; i += 2) {
      if (sources.covers[k](points[i], points[i + 1])) {
        return `The heights could not be read from one of the elevation models${h.sources[k] ? ` (${h.sources[k].label})` : ''}`
      }
    }
  }
  const answer = landingFavourability({
    cols,
    rows,
    spacingEastKm,
    spacingNorthKm,
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

export interface LandingRatingStore {
  subscribe(listener: () => void): () => void
  snapshot(): LandingRatingState
  /** Starts the read unless one is running or one succeeded. A failed read is not kept: the next call tries again. */
  ensure(): void
}

/** One read at a time, a good one kept for the visit, since neither the heights nor the map change. */
export function createLandingRatingStore(read: () => Promise<LandingRatingRead | string>): LandingRatingStore {
  let state: LandingRatingState = { status: 'loading' }
  let reading = false
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
    ensure() {
      if (reading || state.status === 'ready') return
      reading = true
      if (state.status !== 'loading') publish({ status: 'loading' })
      void read()
        .catch((e: unknown) => `The landing rating failed: ${e instanceof Error ? e.message : String(e)}`)
        .then((result) => {
          reading = false
          publish(typeof result === 'string' ? { status: 'failed', reason: result } : { status: 'ready', ...result })
        })
    },
  }
}
