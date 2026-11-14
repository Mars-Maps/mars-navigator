import { unavailable, type Classified, type MarsCoordinate } from '../domain'
import type { SourcedHeights } from '../data/adapters/LayeredElevation'
import {
  initialSpacingKm,
  NO_SLOPE_NEAR_POLE_REASON,
  slopeAtPoint,
  slopeSamplePoints,
} from '../features/route-analysis/pointSlope'

/** What the slope read needs of the elevation chain; `elevation` in `elevation.ts` is one. */
export interface SlopeHeights {
  cellKmAlong(path: readonly MarsCoordinate[]): number
  elevationsAt(points: Float64Array, signal: AbortSignal): Promise<Classified<SourcedHeights>>
  noDataReason: string
}

/** Why the read gave up: each wider read came back from a coarser model again. */
export const SLOPE_DID_NOT_SETTLE_REASON =
  'No slope: the elevation models did not settle on one spacing for the ground around the point'

/**
 * The selected point's slope: nine heights from the chain in one
 * read, then `slopeAtPoint`. If those heights came from a coarser model than
 * the spacing was set for, it reads again wider, at most once per model in
 * the chain, since each wider read can only move to a coarser model.
 */
export async function readSlope(
  point: MarsCoordinate,
  signal: AbortSignal,
  chain: SlopeHeights,
): Promise<Classified<number>> {
  let spacingKm = initialSpacingKm(chain.cellKmAlong([point]))
  for (let reads = 0; ; reads++) {
    const points = slopeSamplePoints(point, spacingKm)
    if (points === null) return unavailable(NO_SLOPE_NEAR_POLE_REASON)
    const heights = await chain.elevationsAt(points, signal)
    if (heights.classification === 'UNAVAILABLE') return heights
    const answer = slopeAtPoint(
      { heights: heights.value.heights, model: heights.value.sourceIndex, models: heights.value.sources },
      spacingKm,
      chain.noDataReason,
    )
    if (answer.kind === 'slope') return answer.slope
    if (reads >= heights.value.sources.length) return unavailable(SLOPE_DID_NOT_SETTLE_REASON)
    spacingKm = answer.spacingKm
  }
}
