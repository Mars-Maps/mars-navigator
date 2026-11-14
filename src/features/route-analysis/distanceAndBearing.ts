import {
  MARS_MEAN_RADIUS_KM,
  derived,
  unavailable,
  type Classified,
  type MarsCoordinate,
} from '../../domain'
import { surfaceDistanceKm } from './routeDistance'

const toRadians = (deg: number) => (deg * Math.PI) / 180
const toDegrees = (rad: number) => (rad * 180) / Math.PI

/** Points closer than this (1 µm) are the same point. */
const SAME_POINT_KM = 1e-9

export interface DistanceAndBearing {
  distanceKm: Classified<number>
  /** Degrees clockwise from north, 0 to <360. */
  initialBearingDeg: Classified<number>
}

/**
 * Distance and initial heading from one surface point to another — what the
 * Measure tool shows.
 *
 * Bearing is the initial great-circle bearing (forward azimuth) on a sphere.
 * It is UNAVAILABLE rather than 0 when no direction exists: identical points,
 * a start at a pole (every direction is south or north), or antipodal points
 * (every great circle connects them).
 */
export function distanceAndBearing(from: MarsCoordinate, to: MarsCoordinate): DistanceAndBearing {
  const km = surfaceDistanceKm(from, to)
  const distanceKm = derived(
    km,
    `Haversine great-circle distance, spherical Mars, R = ${MARS_MEAN_RADIUS_KM} km`,
  )

  // Not `=== 0`: haversine leaves ~1e-13 km of floating-point error between
  // equivalent coordinates such as 0°E and 360°E.
  if (km < SAME_POINT_KM) {
    return { distanceKm, initialBearingDeg: unavailable('Points are identical; no direction') }
  }
  if (Math.abs(from.latitude) === 90) {
    return { distanceKm, initialBearingDeg: unavailable('Start is at a pole; bearing undefined') }
  }
  if (km >= Math.PI * MARS_MEAN_RADIUS_KM * (1 - 1e-12)) {
    return { distanceKm, initialBearingDeg: unavailable('Points are antipodal; bearing undefined') }
  }

  const lat1 = toRadians(from.latitude)
  const lat2 = toRadians(to.latitude)
  const dLon = toRadians(to.longitudeEast - from.longitudeEast)

  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  const bearing = (toDegrees(Math.atan2(y, x)) + 360) % 360

  return {
    distanceKm,
    initialBearingDeg: derived(
      bearing,
      'Initial great-circle bearing (forward azimuth) on a sphere, degrees clockwise from north',
    ),
  }
}
