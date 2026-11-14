import { METABOLIC_COST_METHOD, leastWalkingKcalPerKm, walkingKcalPerKm } from '../metabolicCost'
import type { StepCost } from '../terrainSearch'
import { MAX_GRADIENT, pendingOption, planSearchedRoute, withinSlopeLimit } from './searchedRoute'
import type { RouteTerrain, RoutingStrategy } from './types'
import type { RouteOption, RouteRequest } from '../../../domain'

/**
 * Least human metabolic cost ("energy" is the walker's,
 * not a battery's): the terrain search with each step costed
 * in kilocalories, its length times the cost of walking its slope. Steps
 * over the suited slope limit, or across a line the map marks as a ridge
 * crest, crater rim or delta front, are not walked at all.
 */

/** Kilocalories for one step; Infinity over the slope limit. */
export const energyStepKcal: StepCost = withinSlopeLimit((distanceKm, s) => distanceKm * walkingKcalPerKm(s))

/** The least a walkable step costs per km, on a gentle descent: the heuristic's bound. */
export const MIN_KCAL_PER_KM = leastWalkingKcalPerKm(MAX_GRADIENT)

export const energyEfficient: RoutingStrategy = {
  id: 'energy-efficient',
  objective: 'Least human metabolic cost from departure to destination, through the stops in order',
  requires: [
    'An elevation model as the search lattice: the site model read whole inside its box, the global model by row ranges elsewhere',
    'A published human metabolic cost model: Minetti et al. (2002), priced for a stated body mass',
  ],
  plan: (request) => pendingOption('energy-efficient', request),
  planOnTerrain: planEnergyEfficient,
}

export function planEnergyEfficient(request: RouteRequest, terrain: RouteTerrain, signal: AbortSignal): Promise<RouteOption> {
  return planSearchedRoute(
    'energy-efficient',
    request,
    terrain,
    {
      cost: energyStepKcal,
      minCostPerKm: MIN_KCAL_PER_KM,
      sentence: 'Each step costs its length times the metabolic cost of walking its slope',
      model: METABOLIC_COST_METHOD,
    },
    signal,
  )
}
