import { Sphere, Vector3, type Object3D, type Ray } from 'three'
import type { MarsCoordinate } from '../../domain'
import { FRAME_MIN_ALTITUDE_KM, GLOBE_RADIUS, KM_PER_SCENE_UNIT } from './constants'
import { localPointToCoordinate } from './projection'

/**
 * How high the picture is drawn, as a multiple of the globe radius: the CTX
 * ground under the satellite layer (SurfaceTiles), 2.4 km above the mean
 * sphere. The layers' own tiles are at 1.0006, 0.3 km lower.
 */
export const PICTURE_LIFT = 1.0007

/**
 * The lift every overlay above the grid closes in on as the camera comes
 * down: the coordinate grid's own (CoordinateGrid, GeologyOverlay), which
 * leaves 0.0003 of the radius (1 km) over the tiles, the depth writers
 * under the overlays, for the sag of the overlays' own chords and fills.
 */
export const OVERLAY_BASE_LIFT = 1.001

/**
 * The route's lift, above the grid so it draws over its lines: its pins and
 * dots (RouteOverlay) and, as children of its group and scaled with it, the
 * hover marker and the walk plan. One constant, since a child built at
 * another lift would be scaled wrongly. The pin click test (MarsGlobe) and
 * the drop snap (WalkerDrop) project with it too.
 */
export const ROUTE_LIFT = 1.002

/** At and above this altitude, scene units, overlays keep their full lift: the former zoom floor. */
const FULL_LIFT_ALTITUDE = FRAME_MIN_ALTITUDE_KM / KM_PER_SCENE_UNIT

/**
 * The lift an overlay is drawn at for a camera altitude in scene units.
 * An overlay h above the picture, seen from altitude H, appears H / (H - h)
 * farther from the screen centre than the ground under it: nothing from
 * orbit, but at the 37 km floor a pin 6.8 km up stood 2 km from the click.
 * So below the old floor the part of the lift above the grid's shrinks in
 * step with the altitude, a tenth of it at the floor, and the overlays keep
 * their order. At and above the old floor the lift is `nominal`, as before.
 */
export function overlayLift(nominal: number, altitude: number): number {
  const share = Math.min(1, Math.max(0, altitude / FULL_LIFT_ALTITUDE))
  return OVERLAY_BASE_LIFT + (nominal - OVERLAY_BASE_LIFT) * share
}

/** The scale that moves geometry built at `nominal` to its lift for the altitude. */
export function overlayScale(nominal: number, altitude: number): number {
  return overlayLift(nominal, altitude) / nominal
}

/**
 * The radius clicks and the cursor are read at: the picture's, so over the
 * tiles a coordinate is the ground that was pointed at. Where no tile
 * is drawn (a gap in a mosaic, a tile still loading or failed) the base
 * sphere shows, 2.4 to 4.2 km lower (its facets), and at the floor a pick off
 * the screen centre reads a coordinate 6% to about 11% of its distance from
 * the centre nearer the centre than the ground shown.
 */
export const PICK_RADIUS = GLOBE_RADIUS * PICTURE_LIFT

/**
 * The pick sphere in world space. The globe is centred at the world origin
 * and only turns about it, so the sphere needs no matrix. Never written to.
 */
export const PICK_SPHERE: Readonly<Sphere> = new Sphere(new Vector3(), PICK_RADIUS)

/**
 * The coordinate a pick ray (world space) points at on the picture, or null
 * when it misses the globe. `mesh` is the globe, whose local frame the
 * coordinates are read in; `scratch` is overwritten.
 */
export function pickCoordinate(ray: Ray, mesh: Object3D, scratch: Vector3): MarsCoordinate | null {
  if (!ray.intersectSphere(PICK_SPHERE, scratch)) return null
  return localPointToCoordinate(mesh.worldToLocal(scratch), PICK_RADIUS)
}
