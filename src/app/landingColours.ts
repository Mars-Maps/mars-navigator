import { useEffect, useSyncExternalStore } from 'react'
import { geologicUnitAreas } from '../data/adapters/GeologyAdapter'
import { gridCovers } from '../data/elevation/demGrid'
import { ELEVATION_CHAIN } from '../data/elevation/demSources'
import { DEFAULT_SITE } from '../data/sites/sites'
import { SLOPE_SPACING_CELLS } from '../features/route-analysis/pointSlope'
import { useLandingColours } from '../state'
import { profileHeights } from './elevation'
import type { LandingRatingState } from './landingRatingAt'
import { createLandingRatingStore, readLandingRating } from './landingRatingRead'

/**
 * The landing rating over the site, read for the Plan a walk tool:
 * heights on a lattice from the elevation chain, the crater flag from the
 * site's geologic map, rated by `landingFavourability`. Read once
 * and kept, since neither the heights nor the map change; a failed read,
 * one where a single model failed included, is not kept (`landingRatingRead.ts`).
 */

/**
 * The lattice's least spacing, km: a little over `SLOPE_SPACING_CELLS`
 * cells of the coarsest model in the chain (the 200 m global model today,
 * so 0.41 km), which is what the slope's rule asks for. Finer, and the
 * ground that model covers would have no rating at all. Taken from the
 * chain, so a change of model moves the lattice with it.
 */
export const LANDING_LATTICE_KM = Math.max(...ELEVATION_CHAIN.map((s) => s.cellKm)) * SLOPE_SPACING_CELLS * 1.025

const site = DEFAULT_SITE.site

const store = createLandingRatingStore(() =>
  readLandingRating(site, LANDING_LATTICE_KM, {
    elevationsAt: (points, signal) => profileHeights.elevationsAt(points, signal),
    unitAreas: (bounds, signal) => geologicUnitAreas(bounds, signal),
    covers: ELEVATION_CHAIN.map((source) => (latitude: number, longitudeEast: number) => gridCovers(source, latitude, longitudeEast)),
  }),
)

/**
 * The rating, read the first time `active` is true, and drawn on the globe
 * for as long as it is: the colours show while the landing site is being
 * picked and go when the step is left or the tool closes. After a failed
 * read, leaving the step and coming back tries again.
 */
export function useLandingRating(active: boolean): LandingRatingState {
  const state = useSyncExternalStore(store.subscribe, store.snapshot)
  useEffect(() => {
    if (active) store.ensure()
  }, [active])
  const grid = active && state.status === 'ready' ? state.grid : null
  useEffect(() => {
    if (grid === null) return
    useLandingColours.getState().setLandingColours(grid)
    return () => useLandingColours.getState().clearLandingColours()
  }, [grid])
  return state
}
