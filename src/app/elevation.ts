import { DemElevationAdapter } from '../data/adapters/ElevationAdapter'
import { LayeredElevation } from '../data/adapters/LayeredElevation'
import { ELEVATION_CHAIN } from '../data/elevation/demSources'
import type { SurfaceElevation } from '../features/mars-3d/surfaceElevation'
import type { ProfileHeights } from './routeProfile'

/**
 * The one elevation chain, for the life of the app, so its
 * caches serve every consumer: the Jezero HiRISE 1 m and CTX 20 m models,
 * then the global DEM, each read through its own adapter.
 */
export const elevation = new LayeredElevation(ELEVATION_CHAIN.map((source) => new DemElevationAdapter(source)))
// The layout checks run while the globe loads, not when the walker lands.
elevation.prepare()
/**
 * The 9.7 MB Jezero CTX model is read whole; fetched only when the
 * walker lands, it held the first Jezero ground ~3–6 s past Gale's on a cold
 * cache, sharing S3's six connections with the global model's row reads.
 * The app opens on Jezero, so it is fetched up front, after the
 * globe's first textures have had a head start. Costs 9.7 MB per visit.
 */
export const PREFETCH_SITE_MODELS_MS = 3000
setTimeout(() => elevation.prepare(true), PREFETCH_SITE_MODELS_MS)

/** What the scene gets: heights on a grid, never the adapters themselves. */
export const surfaceElevation: SurfaceElevation = {
  sample: (points, signal) => elevation.sampleGrid(points, signal),
}

/** What a profile gets: nearest cells in one read, each with the model it came from. */
export const profileHeights: ProfileHeights = {
  elevationsAt: (points, signal, onFirst) => elevation.elevationsAt(points, signal, onFirst),
  description: elevation.description,
  noDataReason: elevation.noDataReason,
  cellKmAlong: (path) => elevation.cellKmAlong(path),
}
