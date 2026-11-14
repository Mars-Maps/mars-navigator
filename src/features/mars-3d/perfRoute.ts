import type { MarsCoordinate } from '../../domain'

/**
 * A SIMULATED test route for the performance probe: invented
 * waypoints, not a place, a plan or a measurement. It exists only to put a
 * realistic number of pins and trail dots on the globe while frame time is
 * measured. Deterministic, so measurements on different machines draw the
 * same thing.
 *
 * The points walk east from 0° N, 120° E in steps of STEP_DEG, weaving
 * north and south by up to AMPLITUDE_DEG; longitudes wrap into 0–360.
 */
export const PERF_ROUTE_POINTS = 50
const START: MarsCoordinate = { latitude: 0, longitudeEast: 120 }
const STEP_DEG = 1.5
const AMPLITUDE_DEG = 8

export interface PerfRoute {
  departure: MarsCoordinate
  stops: MarsCoordinate[]
  destination: MarsCoordinate
}

/** `count` waypoints in all, departure and destination included; at least 2. */
export function perfTestRoute(count = PERF_ROUTE_POINTS): PerfRoute {
  const n = Math.max(2, Math.floor(count))
  const points: MarsCoordinate[] = []
  for (let i = 0; i < n; i++) {
    const lon = (START.longitudeEast + i * STEP_DEG) % 360
    points.push({
      latitude: START.latitude + AMPLITUDE_DEG * Math.sin(i / 4),
      longitudeEast: lon < 0 ? lon + 360 : lon,
    })
  }
  return { departure: points[0], stops: points.slice(1, -1), destination: points[n - 1] }
}
