import { boundsSpanDeg, MARS_MEAN_RADIUS_KM, type SiteBounds } from '../../domain'
import { CAMERA_FOV_DEG, FRAME_MIN_ALTITUDE_KM, MAX_CAMERA_ALTITUDE_KM } from './constants'

/**
 * How high the camera flies to show a whole site. Free of Three.js,
 * because the shell imports it into the first load, like wholeGlobeView.
 *
 * The site's longer side subtends `spanDeg` at the planet's centre. Its
 * half-chord sits `depth` below the tangent plane under the camera, so from
 * an altitude `A` it fills `halfChord / (A + depth)` of the half-view. The
 * vertical field of view is used for both axes: the canvas is wider than
 * it is tall, so the width always has room to spare.
 */

/** The site fills this fraction of the view's height, leaving its surroundings in sight. */
export const FRAME_FILL = 0.7

export function altitudeToFrame(
  spanDeg: number,
  fovDeg = CAMERA_FOV_DEG,
  radiusKm = MARS_MEAN_RADIUS_KM,
  limits = { min: FRAME_MIN_ALTITUDE_KM, max: MAX_CAMERA_ALTITUDE_KM },
): number {
  const half = (spanDeg / 2) * (Math.PI / 180)
  const halfChord = radiusKm * Math.sin(half)
  const depth = radiusKm * (1 - Math.cos(half))
  const altitude = halfChord / (FRAME_FILL * Math.tan((fovDeg / 2) * (Math.PI / 180))) - depth
  return Math.min(limits.max, Math.max(limits.min, altitude))
}

/** The altitude that frames `bounds`. */
export function altitudeToFrameBounds(bounds: SiteBounds): number {
  return altitudeToFrame(boundsSpanDeg(bounds))
}
