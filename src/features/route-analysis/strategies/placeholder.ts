import {
  unavailable,
  type RouteOption,
  type RouteRequest,
  type RouteStrategy,
  type SurfacePoint,
} from '../../../domain'
import { detectHazards } from '../hazards'

/** Why each value of a placeholder RouteOption is UNAVAILABLE. */
export const PLACEHOLDER_REASONS = {
  distance:
    'No path has been planned yet; straight lines between waypoints are not the route',
  duration:
    'No time is stated for this route; the cited walking-speed model is applied along a searched route only',
  metabolicEnergy:
    'No energy is stated for this route; the cited metabolic cost model is applied along a searched route only',
  elevation: 'Elevation is looked up after planning; no terrain data yet',
} as const

/**
 * The requested waypoints as surface points, in order, each a copy with a
 * unique id and UNAVAILABLE elevation. Every strategy starts from these.
 */
export function requestedPoints(strategy: RouteStrategy, request: RouteRequest): SurfacePoint[] {
  const waypoints = [request.departure, ...request.stops, request.destination]
  return waypoints.map((coordinate, i) => ({
    id: `${strategy}-wp${i}`,
    coordinate: { ...coordinate },
    elevationMeters: unavailable(PLACEHOLDER_REASONS.elevation),
  }))
}

/**
 * The RouteOption a strategy returns while it has no path: before its cost
 * model exists, while its search runs, or when the search found none.
 *
 * `points` are the requested waypoints in order — departure, stops,
 * destination — exactly as the user picked them. They are not a planned
 * path, and nothing between them is invented: `path` is UNAVAILABLE with
 * `pathReason`, so the scene draws nothing for this option. The metrics
 * are UNAVAILABLE with the same reason when it is the search's, else the
 * standing ones.
 */
export function placeholderOption(
  strategy: RouteStrategy,
  request: RouteRequest,
  pathReason: string,
  metricReasons: { distance: string; duration: string; energy?: string } = PLACEHOLDER_REASONS,
): RouteOption {
  const points = requestedPoints(strategy, request)
  return {
    id: `option-${strategy}`,
    strategy,
    points,
    path: unavailable(pathReason),
    metrics: {
      distanceKm: unavailable(metricReasons.distance),
      durationHours: unavailable(metricReasons.duration),
      metabolicEnergyKcal: unavailable(metricReasons.energy ?? PLACEHOLDER_REASONS.metabolicEnergy),
    },
    hazards: detectHazards(points),
  }
}
