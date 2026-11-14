import type { Classified } from './classification'
import type { MarsCoordinate } from './mars'
import type { RadiationHazardUnit } from './radiation'

/**
 * What is known about the ground at one coordinate. Elevation profiles and
 * slope checks are built from a sequence of these.
 */
export interface TerrainSample {
  coordinate: MarsCoordinate
  elevationMeters: Classified<number>
  slopeDegrees: Classified<number>
}

/**
 * Hazards to a human on the surface. Not rover
 * hazards such as wheel slip.
 */
export type HazardKind =
  | 'slope'
  | 'sudden-drop'
  | 'dust'
  | 'radiation'
  | 'temperature'
  /** What a geologic map marks along the route: a ridge, rim or delta front crossed, a small crater, ridged ground. */
  | 'mapped-obstacle'

/** A mapped obstacle's `unit` when the map could not be read: a view shows it as words, not as a unit. */
export const HAZARD_NOT_CHECKED = 'not checked'

interface HazardBase {
  id: string
  coordinate: MarsCoordinate
  /** How severe, in `unit`. */
  magnitude: Classified<number>
}

/**
 * A radiation hazard is about atmospheric shielding, never a dose:
 * its magnitude is the column mass overhead as a fraction of
 * Gale's, where the only surface dose was measured, and its unit is that
 * named fraction, so no UI can print it as mSv.
 */
export interface RadiationHazard extends HazardBase {
  kind: 'radiation'
  unit: RadiationHazardUnit
}

/**
 * Every other kind. `unit` is a free string only because no real unit has
 * been seen yet: the owner of hazard detection narrows it to a union as
 * soon as the first one exists, to stop 'deg' / 'degrees' drift. A
 * `mapped-obstacle` has no size on its map, so its magnitude is UNAVAILABLE
 * and its `unit` is the map's own wording for the feature, or
 * HAZARD_NOT_CHECKED for an unread map; a view names it from there, not beside
 * a number.
 */
export interface OtherHazard extends HazardBase {
  kind: Exclude<HazardKind, 'radiation'>
  unit: string
}

export type Hazard = RadiationHazard | OtherHazard
