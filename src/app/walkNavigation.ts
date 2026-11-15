import type { MarsCoordinate, RouteRequest, RouteStrategy, WalkPlan } from '../domain'

/**
 * A planned walk handed to navigation: the walk's own stops become
 * the route's, and the route starts and ends at the landing site, so the
 * crew is navigated round the walk and home.
 */

/**
 * The strategies a walk is navigated by. Its stops are already chosen for
 * their science, and it must be walked within its time and energy, so only
 * the two that answer those are offered: the quickest way round and the one
 * that costs the least to walk.
 */
export const WALK_ROUTE_STRATEGIES: readonly RouteStrategy[] = ['fastest', 'energy-efficient']

const same = (a: MarsCoordinate, b: MarsCoordinate) => a.latitude === b.latitude && a.longitudeEast === b.longitudeEast

/**
 * The route request of a planned walk: from the landing site (the
 * walk's first stop), through every other stop in the walk's order, back
 * to the landing site. A walk that already ends on the landing site keeps
 * that as the route's end, not as a stop on it. Null for a plan with no
 * stop to walk to.
 */
export function walkRouteRequest(plan: WalkPlan): RouteRequest | null {
  const [start, ...rest] = plan.stops.map((s) => s.coordinate)
  if (start === undefined) return null
  const stops = rest.length > 0 && same(rest[rest.length - 1], start) ? rest.slice(0, -1) : rest
  if (stops.length === 0) return null
  return { departure: start, stops, destination: start }
}
