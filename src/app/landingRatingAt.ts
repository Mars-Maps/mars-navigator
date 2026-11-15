import { derived, unavailable, type Classified, type MarsCoordinate } from '../domain'
import type { LandingReading } from '../features/mission-ui/walk/LandingStep'
import { LANDING_RATING, landingReasonText } from '../features/route-analysis/landingFavourability'
import { latticeCellAt } from '../features/route-analysis/landingLattice'
import type { LandingColourGrid } from '../state'

/**
 * The landing rating as the shell holds it, and the rating of one
 * point read out of it. Apart from `landingColours.ts`, which reads the
 * network, so this is tested without it.
 */
export interface LandingRatingRead {
  grid: LandingColourGrid
  slopeDeg: Float32Array
  reason: Uint8Array
  /** How the slope, the crater flag and the rating were worked out. */
  method: string
}

export type LandingRatingState =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | ({ status: 'ready' } & LandingRatingRead)

const COLOUR = { [LANDING_RATING.green]: 'green', [LANDING_RATING.yellow]: 'yellow', [LANDING_RATING.red]: 'red' } as const

/** The rating of the cell `point` is in, as the landing step words it: DERIVED with the method, or why there is none. */
export function landingRatingAt(state: LandingRatingState, point: MarsCoordinate): Classified<LandingReading> {
  if (state.status === 'loading') return unavailable('The landing rating is being read')
  if (state.status === 'failed') return unavailable(state.reason)
  const { grid, slopeDeg, reason, method } = state
  const k = latticeCellAt(grid.bounds, grid.cols, grid.rows, point)
  if (k === null) return unavailable('The landing rating covers the site’s box only')
  const code = grid.rating[k]
  if (code === LANDING_RATING.green || code === LANDING_RATING.yellow || code === LANDING_RATING.red) {
    return derived({ colour: COLOUR[code], slopeDeg: slopeDeg[k] }, method)
  }
  return unavailable(landingReasonText(reason[k]) ?? 'No rating for this ground')
}
