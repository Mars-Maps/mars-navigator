import { derived, unavailable, type Classified, type MarsCoordinate } from '../../../domain'
import { toPatch, type PatchFrame } from './surfacePatch'

/**
 * The compass heading on the surface, without a renderer. The
 * patch's +y is north at the patch centre only; 20 km away true north turns
 * by a few degrees at high latitude (about 4° at 85°), and by far more on a
 * patch next to a pole, so north is found at the walker's own place, by
 * stepping a little north and seeing which way that runs on the patch.
 */

/** The step north, in degrees of latitude: about 60 m on Mars. */
const STEP_DEG = 0.001

const METHOD =
  'From the way you face and the direction of true north at your position on the ground patch'

const POLAR = unavailable<number>(
  'Within a patch of a pole the ground has no single north direction',
)

/**
 * Which way true north runs at `here`, in radians clockwise from the
 * patch's +y. Null within a step of either pole: at the north pole north has
 * no direction, at the south pole every direction is north.
 */
export function northOnPatch(frame: PatchFrame, here: MarsCoordinate): number | null {
  if (Math.abs(here.latitude) + STEP_DEG > 90) return null
  const a = toPatch(frame, here)
  const b = toPatch(frame, { latitude: here.latitude + STEP_DEG, longitudeEast: here.longitudeEast })
  const dx = b.xKm - a.xKm
  const dy = b.yKm - a.yKm
  if (dx === 0 && dy === 0) return null
  return Math.atan2(dx, dy)
}

/**
 * Whole degrees clockwise from screen-up to north, in [0, 360), for a
 * walker facing `yawRad` (0 = the patch's +y, positive turns right). Facing
 * where north runs gives 0; facing east, north is on the left: 270.
 */
export function screenHeadingDeg(northRad: number, yawRad: number): number {
  const deg = Math.round(((northRad - yawRad) * 180) / Math.PI)
  return ((deg % 360) + 360) % 360
}

/** The heading the compass shows: DERIVED with its method, UNAVAILABLE near a pole. */
export function walkerHeading(deg: number | null): Classified<number> {
  return deg === null ? POLAR : derived(deg, METHOD)
}

const POSITION_METHOD = 'The walker on the ground patch, from where they stood or teleported and how far they have walked or flown'

/** Where the walker stands, as the store holds it. */
export function walkerPosition(here: MarsCoordinate): Classified<MarsCoordinate> {
  return derived(here, POSITION_METHOD)
}
