import { MARS_MEAN_RADIUS_KM, derived, unavailable, type Classified, type MarsCoordinate } from '../domain'
import type { LandingReading } from '../features/mission-ui/walk/LandingStep'
import { LANDING_RATING, landingReasonText } from '../features/route-analysis/landingFavourability'
import { latticeCellAt } from '../features/route-analysis/landingLattice'
import type { LandingColourGrid } from '../state'

/**
 * The landing rating as the shell holds it, and the rating of one
 * point read out of it. Apart from `landingColours.ts`, which reads the
 * network, so this is tested without it.
 */

/** The rating over one box, at one cell size. */
export interface LandingRatingLayer {
  grid: LandingColourGrid
  slopeDeg: Float32Array
  reason: Uint8Array
  /** How the slope, the crater flag and the rating were worked out. */
  method: string
}

export interface LandingRatingRead {
  /**
   * The rating's layers, the one on top first: a point is rated by the
   * first layer with a colour for it. One layer, or the site's sheet at its
   * fine cells over the ground in view at coarser ones.
   */
  layers: readonly LandingRatingLayer[]
  /** How the colours on the map were worked out, every layer's method in one text. */
  method: string
  /** What the legend adds about where the colours are, when they are not over the ground in view. */
  note?: string
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
  // The first layer with a colour for the point, as the map draws it; with none, the top layer's reason.
  let why: string | null = null
  for (const { grid, slopeDeg, reason, method } of state.layers) {
    const k = latticeCellAt(grid.bounds, grid.cols, grid.rows, point)
    if (k === null) continue
    const code = grid.rating[k]
    if (code === LANDING_RATING.green || code === LANDING_RATING.yellow || code === LANDING_RATING.red) {
      // North to south, a cell is the box's height over its rows: the lattice's own spacing.
      const cellKm = (((grid.bounds.north - grid.bounds.south) / grid.rows) * Math.PI * MARS_MEAN_RADIUS_KM) / 180
      return derived({ colour: COLOUR[code], slopeDeg: slopeDeg[k], cellKm }, method)
    }
    why ??= landingReasonText(reason[k]) ?? 'No rating for this ground'
  }
  return unavailable(why ?? 'The landing rating covers the coloured ground only: bring the landing site into view')
}
