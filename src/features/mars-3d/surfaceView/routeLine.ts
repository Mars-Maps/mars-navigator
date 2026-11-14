import type { DataClassification, MarsCoordinate, RouteOption, RouteStrategy } from '../../../domain'

/**
 * The followed route on the surface view's ground, taken from the
 * option's own `path`: drawn only when the option has a line of its own,
 * with its classification and method carried through; an option without
 * one (the Shortest option, or a search that failed) is said to have none,
 * never a straight line between its waypoints.
 */
export type RouteLine =
  | {
      classification: Exclude<DataClassification, 'UNAVAILABLE'>
      strategy: RouteStrategy
      /** The path's coordinates, in order, at least two. */
      path: readonly MarsCoordinate[]
      /** The method (DERIVED), source (OFFICIAL) or what invented it (SIMULATED). */
      from: string
    }
  | { classification: 'UNAVAILABLE'; strategy: RouteStrategy; reason: string }

/** The line for `route`; null when no route is followed. Pure. */
export function routeLine(route: RouteOption | null): RouteLine | null {
  if (route === null) return null
  const { strategy, path } = route
  if (path.classification === 'UNAVAILABLE') return { classification: 'UNAVAILABLE', strategy, reason: path.reason }
  if (path.value.length < 2) {
    return { classification: 'UNAVAILABLE', strategy, reason: 'its path has under two points, so there is no line' }
  }
  const from = path.classification === 'DERIVED' ? path.method : path.source
  return { classification: path.classification, strategy, path: path.value.map((p) => p.coordinate), from }
}

/** The caption row's sentence for the route's line; the strategy's id reads as its name. */
export function routeLineText(line: RouteLine): string {
  const route = `The ${line.strategy} route`
  if (line.classification === 'UNAVAILABLE') {
    return `${route} has no path to draw: ${line.reason}. Nothing is drawn for it, never a straight line between its waypoints.`
  }
  const what = line.classification === 'SIMULATED' ? 'invented, not a route' : 'its planned path'
  return `${route}: the dashed pale-sand line on the ground, the colour of its dots on the globe, ${what}, draped on this view's heights. The planned walk, when there is one, is the dashed white line.`
}

/** The row's tooltip: where the line's shape comes from, and where its heights do. */
export function routeLineDetail(line: RouteLine): string {
  return line.classification === 'UNAVAILABLE'
    ? line.reason
    : `Path: ${line.from}. Heights: this view's elevation model, so the line sits on the drawn ground.`
}
