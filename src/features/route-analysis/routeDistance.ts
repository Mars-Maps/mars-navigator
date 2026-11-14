import {
  MARS_MEAN_RADIUS_KM,
  derived,
  unavailable,
  type Classified,
  type ExplorationRoute,
  type MarsCoordinate,
} from '../../domain'

const toRadians = (deg: number) => (deg * Math.PI) / 180

/**
 * Great-circle distance between two surface points, in kilometres.
 *
 * Haversine on a sphere of MARS_MEAN_RADIUS_KM. Mars is not a perfect sphere,
 * so this is an approximation — which is exactly why the result is DERIVED and
 * states its method rather than being presented as a measurement.
 */
export function surfaceDistanceKm(a: MarsCoordinate, b: MarsCoordinate): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitudeEast - a.longitudeEast)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  return 2 * MARS_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Total length of a route. UNAVAILABLE for routes with fewer than 2 points. */
export function routeLengthKm(route: ExplorationRoute): Classified<number> {
  if (route.points.length < 2) {
    return unavailable('A route needs at least two points to have a length')
  }

  let total = 0
  for (let i = 1; i < route.points.length; i++) {
    total += surfaceDistanceKm(route.points[i - 1].coordinate, route.points[i].coordinate)
  }

  return derived(
    total,
    `Haversine great-circle distance, spherical Mars, R = ${MARS_MEAN_RADIUS_KM} km`,
  )
}
