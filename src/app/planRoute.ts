import type { RouteOption, RouteRequest } from '../domain'
import { placeholderOption } from '../features/route-analysis/strategies/placeholder'
import { getStrategy, STRATEGY_ORDER } from '../features/route-analysis/strategies/registry'
import type { RouteTerrain } from '../features/route-analysis/strategies/types'

/**
 * Turns the search bar's request into the routes to choose between.
 * The shell does this, not the search bar, because features do not
 * import each other: mission-ui asks, route-analysis answers, and the app
 * joins them.
 *
 * Every strategy answers at once, in the UI's order. A strategy without a
 * method returns its option with `path` UNAVAILABLE and the reason, so the
 * picker can list it honestly; the store picks the first with a DERIVED
 * path to draw (`defaultRouteOption`). A strategy that routes on terrain
 * answers here with "being planned", and for real from
 * `planRouteOnTerrain`.
 */
export function planRouteOptions(request: RouteRequest): RouteOption[] {
  return STRATEGY_ORDER.map((id) => getStrategy(id).plan(request))
}

/**
 * The same options once every terrain search has finished: each strategy
 * with `planOnTerrain` is replaced by its answer, the rest stay as
 * `planRouteOptions` gave them. A search that throws becomes an option
 * whose path says why, so the list is always complete. Cancelled through
 * `signal`, the list is `planRouteOptions`'s again; the caller drops it.
 */
export async function planRouteOnTerrain(
  request: RouteRequest,
  terrain: RouteTerrain,
  signal: AbortSignal,
): Promise<RouteOption[]> {
  return Promise.all(
    STRATEGY_ORDER.map(async (id) => {
      const strategy = getStrategy(id)
      if (!strategy.planOnTerrain) return strategy.plan(request)
      try {
        return await strategy.planOnTerrain(request, terrain, signal)
      } catch (e) {
        if (signal.aborted) return strategy.plan(request)
        const reason = `The planner failed: ${e instanceof Error ? e.message : String(e)}`
        return placeholderOption(id, request, reason, { distance: reason, duration: reason, energy: reason })
      }
    }),
  )
}
