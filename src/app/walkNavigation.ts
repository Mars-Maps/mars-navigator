import type { MarsCoordinate, RouteRequest, RouteStrategy, WalkPlan } from '../domain'
import { useMissionStore, type ViewMode } from '../state'

/**
 * A planned walk handed to navigation: the walk's own stops become
 * the route's, and the route starts and ends at the landing site, so the
 * crew is navigated round the walk and home.
 */

/**
 * The strategies a walk is navigated by. Its stops are already chosen for
 * their science, so the scientific route is not offered: the quickest way
 * round and the one that costs the least to walk are, searched on the terrain.
 *
 * The straight line between the stops is offered last: the same line the
 * walk's legs run on, without the walk's time, energy or flags (the option
 * has no heights, so nothing along it is scanned). It is there because the
 * two searches can both find no way: they refuse every step over the suited
 * slope limit and every mapped crest, where a walk's straight legs only flag
 * them and a walk can be planned at a steeper limit. Without it such a walk
 * would open navigation with no route to draw.
 *
 * As for a typed route, it is the line drawn while the searches run, since
 * it is the first option with a path; when they land the store moves to the
 * first searched route, and stays on the line only where neither has one.
 * It can also be picked by hand.
 */
export const WALK_ROUTE_STRATEGIES: readonly RouteStrategy[] = ['fastest', 'energy-efficient', 'shortest']

/**
 * Whether a walk can be handed to navigation from this view: from close-up
 * only, as the search bar plans a route. Not from the welcome screen, and
 * not while navigating, where the route being followed and the draft
 * typed for it would be replaced without a word (`canTransition` allows a
 * mode to "move" to itself, so it cannot be the test here).
 */
export const canNavigateWalk = (viewMode: ViewMode): boolean => viewMode === 'close-up'

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

/**
 * Hands a planned walk to navigation: its stops become the route's, from
 * the landing site and back to it. The search bar's draft is set to the
 * same route, so the route line reads as the walk and End navigation
 * leaves it there to change. Once navigation has it, the tool closes: the
 * navigation panels take over, and the walk stays in its store. Does
 * nothing where the walk cannot be handed over (`canNavigateWalk`), so a
 * route being followed and its draft are left as they are.
 */
export function navigateWalk(plan: WalkPlan, navigate: (request: RouteRequest) => void): void {
  const request = walkRouteRequest(plan)
  if (!request) return
  if (!canNavigateWalk(useMissionStore.getState().viewMode)) return
  useMissionStore.setState({ routeDraft: { departure: request.departure, destination: request.destination, stops: [...request.stops] } })
  navigate(request)
  if (useMissionStore.getState().viewMode === 'navigation') useMissionStore.getState().setActiveTool(null)
}
