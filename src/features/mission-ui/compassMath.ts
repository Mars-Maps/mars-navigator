import { unavailable, type Classified } from '../../domain'
import type { CameraView, ViewMode } from '../../state'

/**
 * Compass maths. The heading is degrees clockwise from screen-up to
 * north at the view centre: 0 means north is up, 90 means north points right.
 */

/**
 * The heading in [0, 360). Null for NaN or ±Infinity, which have no direction
 * and must never be drawn as one.
 */
export function normalizeHeading(deg: number): number | null {
  if (!Number.isFinite(deg)) return null
  return ((deg % 360) + 360) % 360
}

/**
 * The heading in words, to the whole degree: "North is up", "North is down",
 * or how far right or left of up north points. Null when the heading is not
 * finite.
 */
export function headingText(deg: number): string | null {
  const h = normalizeHeading(deg)
  if (h === null) return null
  const whole = Math.round(h) % 360
  if (whole === 0) return 'North is up'
  if (whole === 180) return 'North is down'
  return whole < 180
    ? `North is ${whole}° right of up`
    : `North is ${360 - whole}° left of up`
}

const NO_VIEW = unavailable<number>('The camera has not reported a view yet')
const NOT_STANDING = unavailable<number>('The ground view has not reported a heading yet')

/**
 * The heading the compass shows: the camera's own, DERIVED or
 * UNAVAILABLE at a pole, in the globe modes. On the surface `camera` still
 * holds the last orbit view, which would point the wrong way, so the
 * walker's own heading is shown instead.
 */
export function compassHeading(
  viewMode: ViewMode,
  camera: CameraView | null,
  walker: Classified<number> | null = null,
): Classified<number> {
  if (viewMode === 'surface') return walker ?? NOT_STANDING
  return camera?.headingDeg ?? NO_VIEW
}

/**
 * Whether the dial is on screen: always while standing on the surface,
 * where the icon panel has no compass button; elsewhere while the
 * button is on.
 */
export function compassShown(viewMode: ViewMode, open: boolean): boolean {
  return viewMode === 'surface' || open
}
