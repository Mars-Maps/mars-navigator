import {
  MARS_MEAN_RADIUS_KM,
  derived,
  unavailable,
  type Classified,
  type GeologicUnitArea,
  type MarsCoordinate,
  type RouteOption,
  type RouteRequest,
  type SiteBounds,
} from '../../../domain'
import { surfaceDistanceKm } from '../routeDistance'
import { DEFAULT_MAX_WALK_KM, SCIENCE_GOALS, candidateStops, insideRings, tangentPlane, type Xy } from '../scienceGoals'
import { SUITED_MAX_KMH, WALKING_SPEED_METHOD } from '../walkingSpeed'
import { fastestStepHours } from './fastest'
import { placeholderOption } from './placeholder'
import { pendingOption, planSearchedRoute } from './searchedRoute'
import type { RouteTerrain, RoutingStrategy } from './types'

/**
 * The scientific route: on the way from departure to
 * destination, stop on the nearest ground of each geologic unit the science
 * goals name (the hand-checked unit table, every goal, since a route request
 * carries none), as far as a stated length allows, and say which units the
 * path crosses. The legs are the fastest route's search, so the
 * slope limit and the map's lines hold as they do there. The count of units
 * crossed, with their names, is the whole claim: no science score.
 */

/**
 * How much longer than the requested route, in straight lines, the science
 * stops may make the walk, km. A project choice, shown with the route: no
 * source gives a suited walking range on Mars.
 */
export const SCIENCE_DETOUR_KM = 5

/** How often the path is tested against the unit polygons, km: finer than the service's ~30 m simplification. */
const UNIT_SAMPLE_KM = 0.025

/** Every unit name the science goals name, with the goal(s) naming it. */
function goalUnits(): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const goal of SCIENCE_GOALS) for (const name of goal.unitNames) byName.set(name, [...(byName.get(name) ?? []), goal.label])
  return byName
}

/** A science stop the route visits or leaves out. */
export interface ScienceStop {
  coordinate: MarsCoordinate
  unitName: string
  /** The map's unit symbol: one unit even where the map spells its name two ways. */
  symbol: string
  /** The goals that name this unit. */
  goals: string[]
  /** For a skipped stop: the straight-line walk length it would have made, km. */
  wouldMakeKm?: number
}

/** The stops chosen and those left out, and the length they were held to. */
export interface SciencePick {
  stops: ScienceStop[]
  skipped: ScienceStop[]
  budgetKm: number
}

/** The straight-line length of departure → `science` → the requested stops → destination, km. */
function straightKm(request: RouteRequest, science: readonly MarsCoordinate[]): number {
  const pts = [request.departure, ...science, ...request.stops, request.destination]
  let km = 0
  for (let i = 1; i < pts.length; i++) km += surfaceDistanceKm(pts[i - 1], pts[i])
  return km
}

/**
 * One candidate per unit the goals name, its polygon nearest the departure
 * within DEFAULT_MAX_WALK_KM (`candidateStops`), a unit the departure
 * already stands on left out. Then, nearest-neighbour from the departure
 * (no optimal tour), each is taken while the straight-line walk stays within
 * the requested route's length plus SCIENCE_DETOUR_KM, and listed as
 * skipped when it would not.
 */
export function pickScienceStops(request: RouteRequest, areas: readonly GeologicUnitArea[]): SciencePick {
  const goalsOf = goalUnits()
  const nearest = new Map<string, ScienceStop & { km: number }>()
  let startSymbol: string | null = null
  for (const [name, goals] of goalsOf) {
    const [start, stop] = candidateStops(
      { id: 'scientific', label: name, unitNames: [name], reason: derived(name, 'unit lookup') },
      request.departure,
      areas,
      { maxStops: 1 },
    )
    if (start.unit.classification !== 'UNAVAILABLE') startSymbol = start.unit.value.symbol
    if (stop === undefined || stop.unit.classification === 'UNAVAILABLE') continue
    const symbol = stop.unit.value.symbol
    const km = surfaceDistanceKm(request.departure, stop.coordinate)
    const known = nearest.get(symbol)
    const merged = known ? [...new Set([...known.goals, ...goals])] : goals
    if (!known || km < known.km) nearest.set(symbol, { coordinate: stop.coordinate, unitName: name, symbol, goals: merged, km })
    else known.goals = merged
  }
  const left = [...nearest.values()].filter((s) => s.symbol !== startSymbol)

  const budgetKm = straightKm(request, []) + SCIENCE_DETOUR_KM
  const stops: ScienceStop[] = []
  const skipped: ScienceStop[] = []
  let at = request.departure
  while (left.length > 0) {
    let best = 0
    for (let i = 1; i < left.length; i++) {
      if (surfaceDistanceKm(at, left[i].coordinate) < surfaceDistanceKm(at, left[best].coordinate)) best = i
    }
    const [{ km: _km, ...next }] = left.splice(best, 1)
    const wouldMakeKm = straightKm(request, [...stops, next].map((s) => s.coordinate))
    if (wouldMakeKm <= budgetKm) {
      stops.push(next)
      at = next.coordinate
    } else skipped.push({ ...next, wouldMakeKm })
  }
  return { stops, skipped, budgetKm }
}

/**
 * The distinct units under `path`, sampled every UNIT_SAMPLE_KM, named as the
 * map names them and counted by symbol, in the order first met. DERIVED
 * from the simplified polygons, with the share of the path the units read
 * did not cover; UNAVAILABLE when no sample falls on a unit.
 */
export function unitsCrossed(path: readonly MarsCoordinate[], areas: readonly GeologicUnitArea[], method: string): Classified<string[]> {
  if (path.length === 0) return unavailable('The route has no path')
  const plane = tangentPlane(path[0])
  const polys = areas
    .map((a) => {
      const rings = a.rings.map((r) => r.map(plane.project)).filter((r) => r.length >= 3)
      // A loop, not Math.min(...xs): a large unit's vertices could pass the engine's argument limit.
      const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
      for (const ring of rings) {
        for (const p of ring) {
          box.x0 = Math.min(box.x0, p.x)
          box.x1 = Math.max(box.x1, p.x)
          box.y0 = Math.min(box.y0, p.y)
          box.y1 = Math.max(box.y1, p.y)
        }
      }
      return { unit: a.unit, rings, box }
    })
    .filter((a) => a.rings.length > 0)
  const unitAt = (p: Xy) =>
    polys.find((a) => p.x >= a.box.x0 && p.x <= a.box.x1 && p.y >= a.box.y0 && p.y <= a.box.y1 && insideRings(p, a.rings))?.unit ?? null

  const names = new Map<string, string>()
  let samples = 0
  let off = 0
  const visit = (p: Xy) => {
    samples++
    const unit = unitAt(p)
    if (unit === null) off++
    else if (!names.has(unit.symbol)) names.set(unit.symbol, unit.name)
  }
  const xy = path.map(plane.project)
  visit(xy[0])
  for (let i = 1; i < xy.length; i++) {
    const n = Math.max(1, Math.ceil(Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y) / UNIT_SAMPLE_KM))
    for (let k = 1; k <= n; k++) visit({ x: xy[i - 1].x + ((xy[i].x - xy[i - 1].x) * k) / n, y: xy[i - 1].y + ((xy[i].y - xy[i - 1].y) * k) / n })
  }
  if (names.size === 0) return unavailable("The path crosses none of the geologic map's units read")
  const offShare = off > 0 ? ` ${Math.max(1, Math.round((off / samples) * 100))}% of the samples fell on no unit read (off the map sheet, or between the simplified polygons) and are not counted.` : ''
  return derived(
    [...names.values()],
    `Distinct units of the geologic map under the path, sampled every ${UNIT_SAMPLE_KM * 1000} m along it, against the map's unit polygons as its service simplifies them (its Map line says how far), so a unit crossed for less than about that may be missed or added; one unit however the map spells its name.${offShare} ${method}`,
  )
}

/** The box round `points`, `km` wider on every side, for the units read. */
function boxAround(points: readonly MarsCoordinate[], km: number): SiteBounds {
  const kmPerDeg = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
  const lats = points.map((p) => p.latitude)
  const lons = points.map((p) => p.longitudeEast)
  const south = Math.min(...lats) - km / kmPerDeg
  const north = Math.max(...lats) + km / kmPerDeg
  const dLon = km / (kmPerDeg * Math.max(0.05, Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180)))
  return { west: Math.min(...lons) - dLon, east: Math.max(...lons) + dLon, south, north }
}

/** What the picked stops are and why, for the path's and the metric's methods. */
function pickText(pick: SciencePick, mapSource: string): string {
  const goals = SCIENCE_GOALS.map((g) => `${g.label} (${g.unitNames.join(', ')})${g.reason.classification === 'UNAVAILABLE' ? '' : `: ${g.reason.value}`}`).join('; ')
  const visited = pick.stops.length > 0 ? pick.stops.map((s) => `${s.unitName} (${s.goals.join(', ')})`).join(', ') : 'none'
  const skipped =
    pick.skipped.length > 0
      ? ` Skipped, as each would make the walk longer than ${pick.budgetKm.toFixed(1)} km in straight lines: ${pick.skipped.map((s) => `${s.unitName} (${s.wouldMakeKm?.toFixed(1)} km)`).join(', ')}.`
      : ''
  return `Science stops: the nearest ground, within ${DEFAULT_MAX_WALK_KM} km of the departure, of each unit the science goals name (${goals}), visited nearest first from the departure (not an optimal tour) while the walk in straight lines stays within the requested route's plus ${SCIENCE_DETOUR_KM} km (a project choice, not a cited range). Visited, by the map's simplified polygons: ${visited}.${skipped} Map: ${mapSource}`
}

export async function planScientific(request: RouteRequest, terrain: RouteTerrain, signal: AbortSignal): Promise<RouteOption> {
  const waypoints = [request.departure, ...request.stops, request.destination]
  const units = await terrain.units(boxAround(waypoints, DEFAULT_MAX_WALK_KM), signal)
  // A cancelled plan answers as before its search, for the caller to drop.
  if (signal.aborted) return pendingOption('scientific', request)
  if (units.classification === 'UNAVAILABLE') {
    const reason = `The geologic map's units could not be read, so no science stop can be chosen: ${units.reason}`
    return placeholderOption('scientific', request, reason, { distance: reason, duration: reason, energy: reason })
  }
  if (units.value.length === 0) {
    // Without units the route would be the fastest one under another name.
    const reason = `The geologic map has no units within ${DEFAULT_MAX_WALK_KM} km of this route, so it has no science stop or unit to cross`
    return placeholderOption('scientific', request, reason, { distance: reason, duration: reason, energy: reason })
  }
  const pick = pickScienceStops(request, units.value)
  if (pick.stops.length === 0) {
    // With no stop of its own the route would be the fastest one under another name.
    const reason =
      pick.skipped.length > 0
        ? `Every science stop in reach (${pick.skipped.map((x) => x.unitName).join(', ')}) would make the walk longer than ${pick.budgetKm.toFixed(1)} km in straight lines, so this route has no science stop`
        : `No ground of a unit the science goals name lies within ${DEFAULT_MAX_WALK_KM} km of the departure off the unit it stands on, so this route has no science stop`
    return placeholderOption('scientific', request, reason, { distance: reason, duration: reason, energy: reason })
  }
  const why = pickText(pick, units.classification === 'DERIVED' ? units.method : units.source)
  const option = await planSearchedRoute(
    'scientific',
    { ...request, stops: [...pick.stops.map((s) => s.coordinate), ...request.stops] },
    terrain,
    {
      cost: fastestStepHours,
      minCostPerKm: 1 / SUITED_MAX_KMH,
      sentence: `${why} Each leg is the fastest route's: each step costs its length over the walking speed for its slope`,
      model: WALKING_SPEED_METHOD,
    },
    signal,
  )
  if (option.path.classification === 'UNAVAILABLE') return option
  const crossed = unitsCrossed(
    option.path.value.map((p) => p.coordinate),
    units.value,
    why,
  )
  return { ...option, metrics: { ...option.metrics, unitsCrossed: crossed } }
}

export const scientific: RoutingStrategy = {
  id: 'scientific',
  objective: "Stops on the nearest ground of each geologic unit the science goals name, within a stated length, on the fastest route's search; the units crossed are its measure",
  requires: [
    "The site's geologic map: unit polygons, and the science goals' reviewed unit table",
    'An elevation model as the search lattice, as the fastest route reads it',
  ],
  plan: (request) => pendingOption('scientific', request),
  planOnTerrain: planScientific,
}
