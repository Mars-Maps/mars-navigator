import type { Classified, GeologicUnitArea, RouteOption, RouteRequest, RouteStrategy, SiteBounds } from '../../../domain'
import type { SearchTerrain } from '../terrainSearch'

/**
 * What a strategy that routes on terrain reads. The shell builds it
 * from the elevation chain and the geology adapter; features never see
 * either. The scientific route also reads the map's unit polygons.
 */
export type RouteTerrain = SearchTerrain & {
  /** The geologic map's unit polygons in a box; UNAVAILABLE when the map could not be read. */
  units: (bounds: SiteBounds, signal: AbortSignal) => Promise<Classified<GeologicUnitArea[]>>
}

/**
 * One way of turning a RouteRequest into a RouteOption. The UI lists these
 * from the registry rather than hard-coding them; display labels stay in the
 * UI layer.
 *
 * `plan` answers at once, from the request alone: a drawn path when the
 * method needs no data (shortest), else an option whose `path` is
 * UNAVAILABLE with the reason. A strategy that routes on terrain also has
 * `planOnTerrain`, whose answer replaces `plan`'s when the search finishes;
 * until then `plan`'s reason says the route is being planned.
 */
export interface RoutingStrategy {
  id: RouteStrategy
  /** What the strategy optimises, in one sentence. */
  objective: string
  /** Data the cost function needs before it can be implemented. */
  requires: readonly string[]
  plan(request: RouteRequest): RouteOption
  planOnTerrain?(request: RouteRequest, terrain: RouteTerrain, signal: AbortSignal): Promise<RouteOption>
}
