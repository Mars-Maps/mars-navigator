import { derived, isAvailable, simulated, unavailable, type Classified } from '../../../domain'
import { normalizeHeading } from '../compassMath'

/**
 * The way pointer's maths, the HUD's arrow: which stop to aim
 * at while standing on the surface, and where it lies on screen. It works on
 * each stop's distance and bearing from the walker (`hudWayPoints`), never
 * on coordinates. Angles are degrees clockwise from straight ahead, the
 * compass dial's convention: 0 ahead, 90 right, 180 behind.
 */

/** One stop of the walk, as seen from where the walker stands. */
export interface WayPoint {
  /** As the planner names the stop. */
  label: string
  /** Great-circle distance from the walker, km. */
  distanceKm: Classified<number>
  /** Initial great-circle bearing from the walker, degrees clockwise from north. */
  bearingDeg: Classified<number>
}

/** Within this distance a point counts as reached: the HUD says so and waits for Next. */
export const ARRIVAL_KM = 0.1

/** The distance as shown: UNAVAILABLE rather than a number that is not a distance. */
export function shownDistance(distance: Classified<number>): Classified<number> {
  if (!isAvailable(distance) || (Number.isFinite(distance.value) && distance.value >= 0)) return distance
  return unavailable('The distance is not a finite number')
}

/** Within ARRIVAL_KM. An unknown distance never counts as reached. */
export function isReached(point: WayPoint): boolean {
  const distance = shownDistance(point.distanceKm)
  return isAvailable(distance) && distance.value <= ARRIVAL_KM
}

/**
 * The stop to aim at: the shared plan's `current`, kept inside the walk.
 * Reaching a stop never moves on by itself: the walker walks whenever the
 * index changes (`WalkDriver`), so only Next or Previous changes it.
 */
export function aimedPoint(points: readonly WayPoint[], current: number): number {
  return Math.max(0, Math.min(points.length - 1, current))
}

/**
 * Where the arrow points: the walker's compass heading (north's angle from
 * straight ahead) plus the bearing to the point. Calculated, so
 * DERIVED and stating both methods, or SIMULATED if either input is;
 * UNAVAILABLE with the reason when either is missing or not finite.
 */
export function pointerAngle(heading: Classified<number>, bearing: Classified<number>): Classified<number> {
  if (!isAvailable(heading)) return unavailable(`No heading: ${heading.reason}`)
  if (!isAvailable(bearing)) return unavailable(`No direction to the point: ${bearing.reason}`)
  const angle = normalizeHeading(heading.value + bearing.value)
  if (angle === null) return unavailable('The heading or the bearing is not a finite number')
  const how = `${provenance(bearing)}; turned to the screen by your compass heading (${provenance(heading)})`
  return heading.classification === 'SIMULATED' || bearing.classification === 'SIMULATED'
    ? simulated(angle, how)
    : derived(angle, how)
}

/** Where a known value came from: a DERIVED value's method, otherwise its source. */
export function provenance<T>(value: Extract<Classified<T>, { value: T }>): string {
  return value.classification === 'DERIVED' ? value.method : value.source
}

/** The angle in words, to the whole degree. Null when it is not finite. */
export function directionText(angleDeg: number): string | null {
  const a = normalizeHeading(angleDeg)
  if (a === null) return null
  const whole = Math.round(a) % 360
  if (whole === 0) return 'Straight ahead'
  if (whole === 180) return 'Behind you'
  return whole < 180 ? `${whole}° to your right` : `${360 - whole}° to your left`
}

/** Metres under 1 km, one decimal under 100 km, whole kilometres beyond. */
export function formatWayDistance(km: number): string {
  const m = Math.round(km * 1000)
  if (m < 1000) return `${m} m`
  const tenths = km.toFixed(1)
  if (Number(tenths) < 100) return `${tenths} km`
  return `${Math.round(km).toLocaleString('en-US')} km`
}
