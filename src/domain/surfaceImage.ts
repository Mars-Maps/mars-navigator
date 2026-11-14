import type { Classified } from './classification'
import type { MarsCoordinate } from './mars'
import type { RoverId, RoverMotionCounter } from './traverse'

/**
 * One photo a rover took on the surface, so the astronaut can see a
 * stop before reaching it. The image itself is OFFICIAL and always shown
 * with its credit. The feed carries no latitude or longitude: `position`
 * is DERIVED by joining `rmc` to the traverse, or UNAVAILABLE.
 */
export interface SurfaceImage {
  /** NASA's image id. */
  id: string
  rover: RoverId
  sol: number
  /** The camera as NASA names it, e.g. "NAVCAM_RIGHT". */
  camera: string
  /** When it was taken, ms since 1970-01-01T00:00:00Z. */
  takenUtcMs: Classified<number>
  /** Local mean solar time at the rover, "HH:MM:SS.sss" as the feed writes it after the sol, e.g. "23:15:09.867". */
  takenLocalMeanSolarTime: Classified<string>
  /** Missing or "UNK" in the feed becomes UNAVAILABLE. */
  rmc: Classified<RoverMotionCounter>
  thumbnailUrl: string
  fullUrl: string
  /** Shown with every image, e.g. "NASA/JPL-Caltech". */
  credit: string
  caption?: string
  position: Classified<MarsCoordinate>
}
