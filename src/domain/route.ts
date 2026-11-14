import type { Classified } from './classification'
import type { MarsCoordinate, SurfacePoint } from './mars'
import type { Hazard } from './terrain'

/**
 * What the user asks for: where to start, where to end, and any stops in
 * between, in order. Coordinates, not SurfacePoints — the user picks places,
 * and what is known about them is looked up afterwards.
 */
export interface RouteRequest {
  departure: MarsCoordinate
  destination: MarsCoordinate
  /** Visited in this order, between departure and destination. May be empty. */
  stops: MarsCoordinate[]
}

/**
 * The routing strategies the interface offers. "Energy-efficient" means
 * human metabolic cost, not battery energy.
 * 'shortest' is the least surface distance through
 * the waypoints in order: the one strategy with a citable method before
 * terrain data exists, so the one route that can honestly be drawn.
 */
export type RouteStrategy = 'fastest' | 'energy-efficient' | 'scientific' | 'shortest'

/**
 * Summary numbers for one route. Every one may be unknown: calculations stay
 * UNAVAILABLE until the data and a citable method exist.
 */
export interface RouteMetrics {
  distanceKm: Classified<number>
  /** Requires a sourced walking-speed model. UNAVAILABLE until one is cited. */
  durationHours: Classified<number>
  /** Requires a published metabolic source. UNAVAILABLE until one is cited. */
  metabolicEnergyKcal: Classified<number>
  /**
   * The geologic map's units the path crosses, named as the map names them,
   * in the order first met. Only the scientific route
   * states it; its count is the route's whole science claim, no score.
   */
  unitsCrossed?: Classified<string[]>
}

/**
 * One proposed answer to a RouteRequest, computed by the planner. Compare
 * ExplorationRoute, which is a route loaded from a dataset.
 */
export interface RouteOption {
  id: string
  strategy: RouteStrategy
  /** The requested waypoints, departure to destination, in order. */
  points: SurfacePoint[]
  /**
   * The line to draw for this option. DERIVED, stating the method,
   * when the strategy can compute a path from the data it has; UNAVAILABLE,
   * with the reason, when it cannot. The scene draws a path only when it is
   * DERIVED, so a strategy without a method never shows a made-up line.
   */
  path: Classified<SurfacePoint[]>
  metrics: RouteMetrics
  /**
   * Hazards found along this route. UNAVAILABLE until detection exists, so an
   * empty list can only ever mean "scanned and none found".
   */
  hazards: Classified<Hazard[]>
}
