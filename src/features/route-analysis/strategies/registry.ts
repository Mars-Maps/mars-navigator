import type { RouteStrategy } from '../../../domain'
import { energyEfficient } from './energyEfficient'
import { fastest } from './fastest'
import { scientific } from './scientific'
import { shortest } from './shortest'
import type { RoutingStrategy } from './types'

/** Every strategy, keyed by id. A Record so a new RouteStrategy fails to compile until added. */
export const ROUTING_STRATEGIES: Record<RouteStrategy, RoutingStrategy> = {
  fastest,
  'energy-efficient': energyEfficient,
  scientific,
  shortest,
}

/**
 * The order the UI lists strategies in: the three terrain strategies, then the
 * geometric extra. The store starts navigation on the first option
 * with a DERIVED path (`defaultRouteOption`), so the order of the unbuilt
 * three does not pick the route.
 */
export const STRATEGY_ORDER: readonly RouteStrategy[] = [
  'fastest',
  'energy-efficient',
  'scientific',
  'shortest',
]

export function getStrategy(id: RouteStrategy): RoutingStrategy {
  return ROUTING_STRATEGIES[id]
}
