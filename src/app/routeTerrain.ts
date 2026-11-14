import { geologicFeatures, geologicUnitAreas } from '../data/adapters/GeologyAdapter'
import type { RouteTerrain } from '../features/route-analysis/strategies/types'
import { elevation } from './elevation'
import { walkHeights } from './walkPlanner'

/**
 * What a route planned on terrain reads: the elevation chain
 * without its row-by-row site model (the CTX model read whole at Jezero,
 * the global 200 m model elsewhere), the geologic map's lines, and its
 * unit polygons for the scientific route. Built here so features
 * never see the adapters.
 */
export const routeTerrain: RouteTerrain = {
  grid: (path) => elevation.searchGridAlong(path),
  heights: (points, signal, cellKm) => walkHeights((p, s) => elevation.searchElevationsAt(p, s, cellKm))(points, signal),
  obstacles: (bounds, signal) => geologicFeatures(bounds, signal),
  units: (bounds, signal) => geologicUnitAreas(bounds, signal),
}
