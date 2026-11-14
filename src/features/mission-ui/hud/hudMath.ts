import {
  derived,
  isAvailable,
  localTrueSolarTimeHours,
  simulated,
  unavailable,
  type Classified,
  type Hazard,
  type MarsCoordinate,
  type MarsSolarTime,
  type WalkPlan,
} from '../../../domain'
import { distanceAndBearing } from '../../route-analysis/distanceAndBearing'
import type { RouteWaypoint } from './routeWaypoints'
import { provenance, type WayPoint } from './wayPointerMath'

/**
 * The HUD's maths: the planned walk's stops seen from where the
 * walker stands, and the sun. It only reads what the host passes in, so the
 * HUD shows the planner's figures and never a second opinion of its own.
 * The slope limit's rule is the stop card's too (`slopeLimit.ts`).
 */

/** One stop of the planned walk as the HUD shows it: a `WalkStop` with the leg into it (`hudStops`). */
export interface HudStop {
  /** As the plan names it, e.g. "Stop 2 · Jezero fan 1 unit". */
  label: string
  coordinate: MarsCoordinate
  /**
   * The steepest stretch of the planned leg into this stop, in degrees,
   * uphill and downhill alike, as the planner measured it (`WalkLeg`).
   * UNAVAILABLE where there are no heights, and at the first stop, where
   * the walk starts.
   */
  steepestSlopeDeg: Classified<number>
  /** The planner's hazards on the leg into this stop (`WalkLeg`), for the radiation glyph. */
  legHazards: Classified<Hazard[]>
}

/** Why the first stop has no leg: the walk starts there. */
const WALK_STARTS_HERE = 'The walk starts here, so no leg leads to this stop'

/**
 * The HUD's stops from the shared plan: each `WalkStop` with
 * the steepest slope and the hazards of `legs[i - 1]`, the leg that leads
 * into it. The first stop is where the walk starts, so no leg leads to it.
 */
export function hudStops(plan: WalkPlan): HudStop[] {
  return plan.stops.map((stop, i) => {
    const leg = i === 0 ? undefined : plan.legs[i - 1]
    const noLeg = i === 0 ? WALK_STARTS_HERE : 'The plan has no leg into this stop'
    return {
      label: stop.label,
      coordinate: stop.coordinate,
      steepestSlopeDeg: leg?.steepestSlopeDeg ?? unavailable<number>(noLeg),
      legHazards: leg?.hazards ?? unavailable<Hazard[]>(noLeg),
    }
  })
}

/** What a walk-plan figure the route does not carry says instead. */
export const ROUTE_ONLY = {
  hazards: 'Route only: the route’s hazards are scanned for the whole route (the hazards panel), not per leg',
} as const

/**
 * The HUD's stops while standing on a followed route with no walk plan:
 * the user's waypoints in order, departure to destination
 * (`routeWaypoints`), with the steepest stretch of the route's
 * elevation profile on the way into each. The route's hazards are for the
 * whole route, so each leg's say they are route-only rather than guess.
 */
export function routeHudStops(waypoints: readonly RouteWaypoint[]): HudStop[] {
  return waypoints.map((w) => ({
    label: w.label,
    coordinate: w.coordinate,
    steepestSlopeDeg: w.legSteepestSlopeDeg ?? unavailable<number>(WALK_STARTS_HERE),
    legHazards: unavailable<Hazard[]>(ROUTE_ONLY.hazards),
  }))
}

type Known<T> = Extract<Classified<T>, { value: T }>

/**
 * Each stop's distance and bearing from the walker, by the same great-circle
 * calculation the planner and the Measure tool use (`distanceAndBearing`).
 * The method also says where the position came from; SIMULATED if the
 * position is, and UNAVAILABLE for every stop while the position is.
 */
export function hudWayPoints(position: Classified<MarsCoordinate>, stops: readonly HudStop[]): WayPoint[] {
  if (!isAvailable(position)) {
    const none = unavailable<number>(`No position: ${position.reason}`)
    return stops.map((s) => ({ label: s.label, distanceKm: none, bearingDeg: none }))
  }
  return stops.map((s) => {
    const { distanceKm, initialBearingDeg } = distanceAndBearing(position.value, s.coordinate)
    return {
      label: s.label,
      distanceKm: fromPosition(distanceKm, position),
      bearingDeg: fromPosition(initialBearingDeg, position),
    }
  })
}

function fromPosition(v: Classified<number>, position: Known<MarsCoordinate>): Classified<number> {
  if (!isAvailable(v)) return v
  const how = `${provenance(v)}, from your position (${provenance(position)})`
  return position.classification === 'SIMULATED' ? simulated(v.value, how) : derived(v.value, how)
}

/** A bearing to the whole degree, 0–359: "132°". */
export function formatBearing(deg: number): string {
  return `${((Math.round(deg) % 360) + 360) % 360}°`
}

/** The sun's elevation as shown: UNAVAILABLE rather than an angle no sun can have. */
export function shownSunElevation(deg: Classified<number>): Classified<number> {
  if (!isAvailable(deg) || (Number.isFinite(deg.value) && Math.abs(deg.value) <= 90)) return deg
  return unavailable('The sun’s elevation is not an angle between −90° and 90°')
}

/** The sun's elevation in words; in `src/lib/` so the surface view's caption shares it. */
export { describeSunElevation } from '../../../lib/horizon'

/**
 * Local true solar time where the walker stands, hours 0–24, from the
 * mission clock (Mars24, the time menu's). DERIVED, SIMULATED if the
 * position is, UNAVAILABLE without the time or the position.
 */
export function localSolarTime(solar: Classified<MarsSolarTime>, position: Classified<MarsCoordinate>): Classified<number> {
  if (!isAvailable(solar)) return unavailable(`No Mars time: ${solar.reason}`)
  if (!isAvailable(position)) return unavailable(`No position: ${position.reason}`)
  const hours = localTrueSolarTimeHours(solar.value, position.value.longitudeEast)
  if (!Number.isFinite(hours)) return unavailable('The local time is not a finite number')
  const how = `Local true solar time at your longitude, from the mission clock in the time menu: ${provenance(solar)}`
  return solar.classification === 'SIMULATED' || position.classification === 'SIMULATED'
    ? simulated(hours, how)
    : derived(hours, how)
}
