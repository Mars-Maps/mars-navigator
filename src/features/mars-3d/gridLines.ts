import { Vector3 } from 'three'
import { LENS_FACTOR } from './constants'
import { coordinateToLocalPoint } from './projection'

/**
 * Pure geometry for the coordinate grid, kept out of the component so
 * it can be tested without a renderer.
 *
 * The grid is a set of levels, coarse to fine. A finer level adds only the
 * lines the coarser ones do not already draw, so where levels overlap no
 * line is drawn twice. Finer levels fade in as the camera comes down, which
 * keeps a similar number of lines on screen at every altitude.
 */

export interface GridLevel {
  /** Spacing of parallels and meridians, degrees. Divides 90 and 360. */
  stepDeg: number
  /** Fully visible below this camera altitude, km. Infinity: always. */
  maxAltitudeKm: number
  /** Line opacity when fully visible. Finer levels are fainter. */
  opacity: number
}

/**
 * Coarse to fine. Thresholds keep a handful of lines on screen; they were
 * tuned for the 45° reference lens and follow the current one through
 * LENS_FACTOR: near the floor the view spans about 3°, so 1° lines.
 */
export const GRID_LEVELS: readonly GridLevel[] = [
  { stepDeg: 30, maxAltitudeKm: Infinity, opacity: 0.5 },
  { stepDeg: 10, maxAltitudeKm: 8000 * LENS_FACTOR, opacity: 0.42 },
  { stepDeg: 5, maxAltitudeKm: 2500 * LENS_FACTOR, opacity: 0.36 },
  { stepDeg: 1, maxAltitudeKm: 700 * LENS_FACTOR, opacity: 0.3 },
]

/** Degrees between vertices along a line; short chords stay on the sphere. */
const SAMPLE_DEG = 2
/** A level starts fading in at this multiple of its threshold altitude. */
const FADE_START = 1.5

/** True when `deg` falls on a line of a `stepDeg` grid. */
function onGrid(deg: number, stepDeg: number): boolean {
  const n = deg / stepDeg
  return Math.abs(n - Math.round(n)) < 1e-9
}

/**
 * Line-segment vertex positions (x, y, z per vertex, two vertices per
 * segment) for parallels and meridians every `stepDeg`, leaving out any
 * line on the coarser `skipDeg` grid. Points are in mesh-local space at
 * `radius`, through the same convention as every other surface point.
 */
export function buildGridLines(
  stepDeg: number,
  skipDeg: number | null,
  radius: number,
): Float32Array {
  const out: number[] = []
  const p = new Vector3()
  const push = (latitude: number, longitudeEast: number) => {
    coordinateToLocalPoint({ latitude, longitudeEast }, radius, p)
    out.push(p.x, p.y, p.z)
  }
  const keep = (deg: number) => skipDeg === null || !onGrid(deg, skipDeg)

  // Parallels; the poles are points, not lines.
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    if (!keep(lat)) continue
    for (let lon = 0; lon < 360; lon += SAMPLE_DEG) {
      push(lat, lon)
      push(lat, lon + SAMPLE_DEG)
    }
  }
  // Meridians, pole to pole.
  for (let lon = 0; lon < 360; lon += stepDeg) {
    if (!keep(lon)) continue
    for (let lat = -90; lat < 90; lat += SAMPLE_DEG) {
      push(lat, lon)
      push(lat + SAMPLE_DEG, lon)
    }
  }
  return new Float32Array(out)
}

/**
 * How visible a level is at this camera altitude, 0 to 1: fully visible
 * at or below its threshold, fading out linearly up to FADE_START times it.
 */
export function levelFade(altitudeKm: number, maxAltitudeKm: number): number {
  if (altitudeKm <= maxAltitudeKm) return 1
  const fadeTop = maxAltitudeKm * FADE_START
  if (altitudeKm >= fadeTop) return 0
  return (fadeTop - altitudeKm) / (fadeTop - maxAltitudeKm)
}
