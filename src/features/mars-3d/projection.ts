import { Vector3 } from 'three'
import type { MarsCoordinate } from '../../domain'

/**
 * How the globe mesh's local space relates to surface coordinates.
 *
 * Three.js SphereGeometry wraps an equirectangular texture so that u = 0
 * (the image's left edge) faces −X and the image centre faces +X, with u
 * increasing counter-clockwise seen from +Y (north). The NASA Mars Trek
 * tile grid starts at 180°W (= 180°E in the 0–360 convention), so:
 *
 *   phi = atan2(z, −x) in [0, 2π)  ↔  longitude west-positive −180..180
 *
 * These two functions are the only place that convention lives. Pass points
 * in the MESH's local space (mesh.worldToLocal) so tilt and spin are
 * already accounted for.
 */

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const TWO_PI = 2 * Math.PI

/**
 * A point on (or near) the globe in mesh-local space → surface coordinate.
 * Pass `target` to reuse an object from a frame loop.
 */
export function localPointToCoordinate(
  p: Vector3,
  radius: number,
  target?: MarsCoordinate,
): MarsCoordinate {
  const sinLat = Math.min(1, Math.max(-1, p.y / radius))
  const latitude = Math.asin(sinLat) * DEG
  let phi = Math.atan2(p.z, -p.x)
  if (phi < 0) phi += TWO_PI
  const lon180 = (phi / TWO_PI) * 360 - 180
  const longitudeEast = ((lon180 % 360) + 360) % 360
  if (!target) return { latitude, longitudeEast }
  target.latitude = latitude
  target.longitudeEast = longitudeEast
  return target
}

/**
 * Surface coordinate → point in mesh-local space at `radius` from the
 * centre. Pass a radius slightly above the globe's to sit a marker on the
 * surface. Reuses `target` so callers can avoid allocating per frame.
 */
export function coordinateToLocalPoint(
  c: MarsCoordinate,
  radius: number,
  target: Vector3 = new Vector3(),
): Vector3 {
  const lon180 = c.longitudeEast > 180 ? c.longitudeEast - 360 : c.longitudeEast
  const phi = ((lon180 + 180) / 360) * TWO_PI
  const lat = c.latitude * RAD
  const ring = radius * Math.cos(lat)
  return target.set(-ring * Math.cos(phi), radius * Math.sin(lat), ring * Math.sin(phi))
}

/**
 * The globe's spin angle (its mesh `rotation.y`) that puts `longitudeEast`
 * on the line from the globe's centre to a camera on the world +z axis, so
 * the app opens turned to its site. Latitude is the camera's to
 * handle; the tilt group leaves the line a little off centre, which is
 * fine for a welcome view.
 */
export function spinToFace(longitudeEast: number): number {
  const lon180 = longitudeEast > 180 ? longitudeEast - 360 : longitudeEast
  const phi = ((lon180 + 180) / 360) * TWO_PI
  // The point sits at (-cos φ, ·, sin φ); a rotation about y by θ takes its
  // azimuth atan2(x, z) to atan2(x, z) + θ, and the camera sees azimuth 0.
  return -Math.atan2(-Math.cos(phi), Math.sin(phi))
}
