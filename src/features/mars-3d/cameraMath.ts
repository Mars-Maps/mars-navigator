import type { Vector3 } from 'three'
import { derived, unavailable, type Classified } from '../../domain'

/**
 * Pure camera arithmetic for the controller, kept out of the React
 * component so it can be tested without a renderer. Altitudes are in scene
 * units above the globe's surface.
 */

export interface AltitudeLimits {
  min: number
  max: number
}

/** Altitude multiplier per pixel of wheel travel. */
const WHEEL_ZOOM_RATE = 0.0015

/**
 * Altitude multiplier per pixel of touchpad pinch. Browsers report a
 * pinch as wheel events with ctrlKey set and 1-5 px deltas, so at the wheel
 * rate a full pinch barely moved the camera. At this rate a full pinch
 * (roughly 100-150 px of travel) covers about what eight wheel notches do.
 */
const PINCH_ZOOM_RATE = 0.01

/** Largest pixel delta read as a pinch; pinches send 1-5 px, a mouse notch about 100. */
const PINCH_MAX_DELTA = 50

/**
 * Whether a wheel event is a touchpad pinch. Browsers set ctrlKey on
 * a pinch, but also when Ctrl is held over a real mouse wheel, common on
 * Windows; that sends whole notches, or lines, so only small pixel deltas
 * count as a pinch and Ctrl + wheel keeps the wheel rate.
 */
export function isPinch(ctrlKey: boolean, deltaMode: number, deltaY: number): boolean {
  return ctrlKey && deltaMode === 0 && Math.abs(deltaY) < PINCH_MAX_DELTA
}

/**
 * Wheel travel → altitude multiplier. Exponential, so every notch changes
 * the altitude by the same ratio whether the camera is high or low.
 * Positive delta (wheel towards the user, or pinching in) zooms out.
 * `pinch` is a touchpad pinch, which reports far smaller deltas.
 */
export function wheelZoomFactor(deltaPixels: number, pinch = false): number {
  return Math.exp(deltaPixels * (pinch ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE))
}

/** Altitude after applying `factor`, held inside the limits. */
export function zoomAltitude(
  altitude: number,
  factor: number,
  limits: AltitudeLimits,
): number {
  return Math.min(limits.max, Math.max(limits.min, altitude * factor))
}

/**
 * How far to swing the view centre towards the point under the cursor when
 * zooming in from `from` to `to`: halving the altitude moves halfway there,
 * which keeps that point roughly under the cursor. Zooming out moves
 * straight back, so the result is 0.
 */
export function towardCursorFraction(from: number, to: number): number {
  return to < from && from > 0 ? 1 - to / from : 0
}

/**
 * Drag sensitivity for OrbitControls, scaled with altitude so the surface
 * moves under the pointer at a similar speed close up and far out.
 * `lensFactor` is how much farther the camera sits for the same ground
 * than with the 45° reference lens (constants.LENS_FACTOR), so the
 * speed follows the ground on screen rather than the altitude.
 */
export function rotateSpeedForAltitude(altitude: number, radius: number, lensFactor = 1): number {
  // The floor was 0.03 while the camera stopped at 374 km, where the formula
  // gives about that; at the 37 km floor it gives about 0.003, and a
  // 0.03 clamp turned the ground ten times faster than the pointer.
  return Math.min(1, Math.max(0.002, altitude / (radius * 2.2 * lensFactor)))
}

/**
 * The camera's near plane for an altitude, scene units: a quarter of
 * the altitude, between 0.01 (10 km, under the 37 km floor) and 0.1 (100 km,
 * the earlier fixed value). Depth precision falls with the near plane, so it
 * stays at 100 km while the camera is high, where the tiles (2 km), the grid
 * (3.4 km) and the sphere are drawn a few km apart, and comes down only as
 * the camera does.
 */
export function nearForAltitude(altitude: number): number {
  return Math.min(0.1, Math.max(0.01, altitude / 4))
}

/** Frame-rate-independent fraction of the remaining distance to cover this frame. */
export function easeStep(deltaSeconds: number, ratePerSecond: number): number {
  return 1 - Math.exp(-ratePerSecond * deltaSeconds)
}

/**
 * Keeps a unit view direction at least `margin` radians from either pole,
 * in place, matching the polar limits OrbitControls enforces. Without this,
 * an animation aimed at a pole would chase a direction it can never reach.
 */
export function clampPolar(dir: Vector3, margin: number): Vector3 {
  const maxY = Math.cos(margin)
  if (Math.abs(dir.y) <= maxY) return dir
  const ring = Math.hypot(dir.x, dir.z)
  const sinM = Math.sin(margin)
  // Exactly at a pole there is no azimuth to keep; any one will do.
  const x = ring > 0 ? (dir.x / ring) * sinM : sinM
  const z = ring > 0 ? (dir.z / ring) * sinM : 0
  return dir.set(x, Math.sign(dir.y) * maxY, z)
}

const DEG = Math.PI / 180

/** Within this angle of a pole, north has no single on-screen direction. */
export const HEADING_POLE_MARGIN_DEG = 0.5

export const HEADING_METHOD =
  "North's direction on screen at the view centre: the globe's spin axis, " +
  'with the published axial tilt and the current spin, projected onto the ' +
  'surface tangent plane there, as an angle clockwise from screen-up'

/**
 * Degrees clockwise from screen-up to north at the view centre, in
 * [0, 360). `viewDir` points from the globe centre to the view
 * centre, `northAxis` is the globe's north pole direction, and `screenUp`
 * and `screenRight` are the camera's axes, all in world space.
 *
 * The camera looks at the globe centre, so the tangent plane at the view
 * centre is parallel to the screen and north's tangent direction maps to
 * the screen without perspective distortion. No second point is
 * projected, so nothing can fall behind the horizon.
 *
 * Reads the vectors only; no allocation besides the result.
 */
export function northHeading(
  viewDir: Vector3,
  northAxis: Vector3,
  screenUp: Vector3,
  screenRight: Vector3,
): Classified<number> {
  const dLen = viewDir.length()
  const nLen = northAxis.length()
  if (!(dLen > 0 && nLen > 0 && Number.isFinite(dLen) && Number.isFinite(nLen))) {
    return unavailable('Heading could not be computed from the camera and globe orientation')
  }
  const along = viewDir.dot(northAxis) / (dLen * nLen)
  // North's tangent at the view centre: the axis minus its part along the view.
  const k = (along * nLen) / dLen
  const tx = northAxis.x - viewDir.x * k
  const ty = northAxis.y - viewDir.y * k
  const tz = northAxis.z - viewDir.z * k
  // |t| / |n| is the sine of the angle between the view centre and the pole.
  if (Math.hypot(tx, ty, tz) / nLen < Math.sin(HEADING_POLE_MARGIN_DEG * DEG)) {
    const pole = along > 0 ? 'north' : 'south'
    return unavailable(
      `View centre is within ${HEADING_POLE_MARGIN_DEG}° of the ${pole} pole, where north has no single direction`,
    )
  }
  const right = tx * screenRight.x + ty * screenRight.y + tz * screenRight.z
  const up = tx * screenUp.x + ty * screenUp.y + tz * screenUp.z
  // atan2 turns an infinite or all-zero input into a clean angle, so check first.
  if (!Number.isFinite(right) || !Number.isFinite(up) || (right === 0 && up === 0)) {
    return unavailable('Heading could not be computed from the camera and globe orientation')
  }
  const deg = Math.atan2(right, up) / DEG
  // -0 and a rounding up to 360 both read as 0.
  const wrapped = deg < 0 ? deg + 360 : deg + 0
  return derived(wrapped >= 360 ? 0 : wrapped, HEADING_METHOD)
}

/**
 * Whether a point on a globe centred at the origin faces `cameraPosition`:
 * the line from the point to the camera leaves the surface
 * outward. `scratch` is reused so a frame loop allocates nothing.
 */
export function facesCamera(point: Vector3, cameraPosition: Vector3, scratch: Vector3): boolean {
  return scratch.copy(cameraPosition).sub(point).dot(point) > 0
}
