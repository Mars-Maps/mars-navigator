import { isAvailable, type MarsCoordinate, type RouteOption, type RouteRequest } from '../domain'
import type { ViewMode } from './viewMode'

/**
 * A route while the user is still building it in the search bar. Departure
 * and destination may not be chosen yet; a complete draft becomes a
 * RouteRequest via toRouteRequest().
 *
 * A `null` stop is a row the user has but whose entry is empty or invalid.
 * It is kept, so the row and its place in the order survive, but it
 * is never replaced by an earlier value: the draft is incomplete until it
 * is fixed or removed, exactly like a missing departure or destination.
 */
export interface RouteDraft {
  departure: MarsCoordinate | null
  destination: MarsCoordinate | null
  stops: (MarsCoordinate | null)[]
}

export const EMPTY_ROUTE: RouteDraft = {
  departure: null,
  destination: null,
  stops: [],
}

/**
 * Where Set point puts a point: the departure while it is empty,
 * then the destination while it is empty; with both chosen the user
 * decides, so the chooser opens.
 */
export function setPointSlot(draft: RouteDraft): 'departure' | 'destination' | 'choose' {
  if (!draft.departure) return 'departure'
  if (!draft.destination) return 'destination'
  return 'choose'
}

/**
 * A draft becomes a request only once both ends are chosen and every stop
 * has a valid coordinate.
 */
export function toRouteRequest(draft: RouteDraft): RouteRequest | null {
  if (!draft.departure || !draft.destination) return null
  const stops: MarsCoordinate[] = []
  for (const stop of draft.stops) {
    if (stop === null) return null
    stops.push(stop)
  }
  return { departure: draft.departure, destination: draft.destination, stops }
}

/**
 * The option navigation starts on: the first whose path is DERIVED,
 * so the route drawn is one with a method, else the first listed, so the
 * picker still shows every strategy's reason. null for no options.
 */
export function defaultRouteOption(options: readonly RouteOption[]): RouteOption | null {
  return options.find((o) => isAvailable(o.path)) ?? options[0] ?? null
}

/**
 * The state change when a terrain search replaces the options while
 * navigating: a chosen option stays chosen by id; a user still on the
 * default gets the new default, so the fastest route is drawn when it
 * lands. Null, and nothing changes, when not navigating, for an empty list,
 * or when the chosen id is gone.
 *
 * Standing on the route counts as navigating: the surface view
 * entered from navigation keeps the route, so a search that lands meanwhile
 * must land too, or the options said "Searching…" for good once the walker
 * came back. The walker keeps the route under their feet, by id, even on the
 * default: the drop snapped them to that line, and moving it to the new
 * default would take the route out from under them.
 */
export function replacedRouteOptions(
  s: {
    viewMode: ViewMode
    activeRoute: RouteOption | null
    routeOptions: readonly RouteOption[]
    /** Where the surface view was entered from; only read while the mode is surface. Required, so no caller forgets it. */
    surfaceReturn: 'close-up' | 'navigation'
  },
  options: readonly RouteOption[],
): { activeRoute: RouteOption; routeOptions: RouteOption[] } | null {
  const standing = s.viewMode === 'surface' && s.surfaceReturn === 'navigation'
  if ((s.viewMode !== 'navigation' && !standing) || !s.activeRoute || options.length === 0) return null
  const chosen = s.activeRoute.id
  const onDefault = !standing && chosen === defaultRouteOption(s.routeOptions)?.id
  const route = onDefault ? defaultRouteOption(options) : (options.find((o) => o.id === chosen) ?? null)
  return route ? { activeRoute: route, routeOptions: [...options] } : null
}

/** One end of the route draft. */
export type RouteEnd = 'departure' | 'destination'

/**
 * The draft without its departure or destination. If the draft has
 * valid stops, the stop nearest the removed end takes its place and leaves
 * the stops, so the route keeps two ends while it can. The same draft when
 * that end is not chosen.
 */
export function withoutRouteEnd(draft: RouteDraft, end: RouteEnd): RouteDraft {
  const removed = draft[end]
  if (!removed) return draft
  let nearest = -1
  let nearestAngle = Infinity
  draft.stops.forEach((stop, i) => {
    if (!stop) return
    const angle = centralAngle(removed, stop)
    if (angle < nearestAngle) {
      nearest = i
      nearestAngle = angle
    }
  })
  if (nearest < 0) return { ...draft, [end]: null }
  return {
    ...draft,
    [end]: draft.stops[nearest],
    stops: draft.stops.filter((_, i) => i !== nearest),
  }
}

/** The angle between two surface points, radians: only compared, never shown. */
function centralAngle(a: MarsCoordinate, b: MarsCoordinate): number {
  const rad = Math.PI / 180
  const [ax, ay, az] = unit(a.latitude * rad, a.longitudeEast * rad)
  const [bx, by, bz] = unit(b.latitude * rad, b.longitudeEast * rad)
  return 2 * Math.asin(Math.min(1, Math.hypot(ax - bx, ay - by, az - bz) / 2))
}

function unit(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}
