import type { MarsCoordinate } from './mars'

/**
 * The mission clock: one UTC instant shared by the 3D scene and the UI.
 *
 * An Earth UTC instant is the single input. Everything Martian (sol date,
 * local solar time, where the sun is overhead) is calculated from it, so
 * there is exactly one thing to set and nothing can drift out of step.
 *
 * Whether the official dataset uses UTC, sols or both varies by source. Adapters convert into this.
 */
export interface TimeState {
  /** Milliseconds since 1970-01-01T00:00:00Z, as from Date.now(). */
  utcMs: number
}

/**
 * Sun geometry and Mars time for one instant, from the Mars24 algorithm
 * (see mars24.ts). Always wrapped in Classified as DERIVED with its method.
 */
export interface MarsSolarTime {
  /** Mars Sol Date: sols since 29 Dec 1873, the Mars analogue of Julian Day. */
  marsSolDate: number
  /** Coordinated Mars Time: mean solar time at 0°E, in hours 0–24. */
  coordinatedMarsTimeHours: number
  /** Areocentric solar longitude Ls, degrees 0–360. Ls 0 is northern spring. */
  solarLongitudeDeg: number
  /** Equation of time, degrees. True minus mean solar time; 15° = 1 hour. */
  equationOfTimeDeg: number
  /** Mars–Sun distance, astronomical units: what scales the sunlight. */
  heliocentricDistanceAu: number
  /**
   * Where the sun is directly overhead. Latitude is the solar declination;
   * longitude is degrees EAST 0–360, the project convention (mars.ts).
   */
  subsolarPoint: MarsCoordinate
}
