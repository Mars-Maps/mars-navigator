import { derived, unavailable, type RouteOption, type RouteRequest } from '../../../domain'
import { detectHazards } from '../hazards'
import { routeLengthKm } from '../routeDistance'
import { PLACEHOLDER_REASONS, requestedPoints } from './placeholder'
import type { RoutingStrategy } from './types'

/** How the shortest path is drawn: what the DERIVED `path` states as its method. */
export const SHORTEST_PATH_METHOD =
  'Great-circle legs between the waypoints in order, on a spherical Mars; terrain is not considered'

/**
 * Least surface distance through the waypoints in order.
 * The one strategy with a citable method before terrain data exists:
 * each leg is the great circle between consecutive waypoints, and the
 * distance is routeLengthKm's haversine total. It says nothing about time,
 * energy or hazards, which stay UNAVAILABLE with their reasons.
 */
export const shortest: RoutingStrategy = {
  id: 'shortest',
  objective: 'Least surface distance from departure to destination, through the stops in order',
  requires: ['Nothing beyond the waypoints: geometry only, no terrain'],
  plan(request: RouteRequest): RouteOption {
    const points = requestedPoints('shortest', request)
    const distanceKm = routeLengthKm({
      id: 'option-shortest',
      name: 'Shortest distance',
      classification: 'DERIVED',
      points,
    })
    return {
      id: 'option-shortest',
      strategy: 'shortest',
      points,
      // The path is the waypoints themselves: the scene draws great circles
      // between consecutive points, which is exactly this method.
      path: derived(points, SHORTEST_PATH_METHOD),
      metrics: {
        distanceKm,
        durationHours: unavailable(PLACEHOLDER_REASONS.duration),
        metabolicEnergyKcal: unavailable(PLACEHOLDER_REASONS.metabolicEnergy),
      },
      hazards: detectHazards(points),
    }
  },
}
