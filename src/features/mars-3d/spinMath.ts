import { Quaternion, Vector3 } from 'three'
import { isAvailable } from '../../domain'
import { northHeading } from './cameraMath'
import { isWholeGlobeView } from './wholeGlobeView'

/**
 * The demonstration spin, north-up. The globe sits in a group at the
 * published axial tilt; spinning about that axis read as a diagonal spin.
 * While the spin runs the group eases until north is screen-up, so the spin
 * turns about the screen's vertical axis, counter-clockwise seen from above
 * north (prograde). The sun light rides inside the mesh, so
 * the terminator stays on the surface through the ease.
 */

/** Ease rate: 25° of tilt is within NORTH_UP_SNAP_RAD in about 0.9 s. */
export const NORTH_UP_RATE_PER_S = 7

/** Closer than this, north snaps to screen-up and the ease is done. */
export const NORTH_UP_SNAP_RAD = 1e-3

/** No input for this long at a whole-globe view restarts the spin. */
export const SPIN_RESTART_DELAY_MS = 30_000

/** Scratch objects for northUpStep, created once per mount. */
export function createNorthUpScratch() {
  return { north: new Vector3(), full: new Quaternion(), partial: new Quaternion() }
}

export type NorthUpScratch = ReturnType<typeof createNorthUpScratch>

/**
 * Turns `tilt` (the tilt group's world orientation; its local +y is north)
 * `fraction` of the way towards north = `screenUp`, in place, by the
 * smallest rotation. Snaps the last NORTH_UP_SNAP_RAD. Returns true once
 * north is screen-up. `screenUp` must be a unit vector.
 */
export function northUpStep(
  tilt: Quaternion,
  screenUp: Vector3,
  fraction: number,
  scratch: NorthUpScratch,
): boolean {
  const north = scratch.north.set(0, 1, 0).applyQuaternion(tilt)
  const angle = north.angleTo(screenUp)
  if (angle === 0) return true
  scratch.full.setFromUnitVectors(north, screenUp)
  if (angle < NORTH_UP_SNAP_RAD) {
    tilt.premultiply(scratch.full).normalize()
    return true
  }
  scratch.partial.identity().slerp(scratch.full, fraction)
  tilt.premultiply(scratch.partial).normalize()
  return false
}

/** Scratch objects for northUpRollStep, created once per mount. */
export function createNorthUpRollScratch() {
  return { north: new Vector3(), turn: new Quaternion() }
}

export type NorthUpRollScratch = ReturnType<typeof createNorthUpRollScratch>

/**
 * The compass's "turn north up", one frame of it. Turns `tilt` (the
 * tilt group's world orientation; its local +y is north) about the view
 * line, `fraction` of the way to north = screen-up at the view centre.
 *
 * Unlike northUpStep, which lines the axis up with screen-up and so slides
 * the view centre across the surface, a turn about the view line keeps the
 * point under the view centre where it is: only which way north points
 * changes. Snaps the last NORTH_UP_SNAP_RAD.
 *
 * `viewDir` is the unit vector from the globe centre to the camera;
 * `screenUp` and `screenRight` are the camera's screen axes in world space.
 * Returns 'done' once north is up, 'turning' before that, and 'unavailable'
 * when the view centre has no heading (near a pole): the turn stops there.
 */
export function northUpRollStep(
  tilt: Quaternion,
  viewDir: Vector3,
  screenUp: Vector3,
  screenRight: Vector3,
  fraction: number,
  scratch: NorthUpRollScratch,
): 'turning' | 'done' | 'unavailable' {
  const north = scratch.north.set(0, 1, 0).applyQuaternion(tilt)
  const heading = northHeading(viewDir, north, screenUp, screenRight)
  if (!isAvailable(heading)) return 'unavailable'
  // Clockwise from up, in (-180, 180]: the shorter way round.
  const deg = heading.value > 180 ? heading.value - 360 : heading.value
  const angle = (deg * Math.PI) / 180
  if (angle === 0) return 'done'
  // A turn by +angle about the view line (towards the viewer) is
  // counter-clockwise on screen, which undoes a clockwise heading.
  const snap = Math.abs(angle) < NORTH_UP_SNAP_RAD
  scratch.turn.setFromAxisAngle(viewDir, snap ? angle : angle * fraction)
  tilt.premultiply(scratch.turn).normalize()
  return snap ? 'done' : 'turning'
}

export interface SpinRestart {
  /** A settled view while the spin is stopped. */
  view(altitudeKm: number): void
  /** Any pointer, wheel or key input; restarts a running wait. */
  input(): void
  /** The spin started, or the mode does not spin; cancel any wait. */
  reset(): void
  dispose(): void
}

/**
 * The thirty-second wait. A settled whole-globe view with the spin
 * stopped starts it, a closer view cancels it, and any input restarts it.
 * In close-up the ten-second welcome return comes first and
 * restarts the spin itself, so this wait matters in welcome, where a
 * keyboard zoom stops the spin without leaving the mode.
 */
export function createSpinRestart(
  onRestart: () => void,
  delayMs = SPIN_RESTART_DELAY_MS,
  wholeGlobe: (altitudeKm: number) => boolean = isWholeGlobeView,
): SpinRestart {
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const arm = () => {
    clear()
    timer = setTimeout(() => {
      timer = null
      onRestart()
    }, delayMs)
  }

  return {
    view(altitudeKm) {
      if (wholeGlobe(altitudeKm)) arm()
      else clear()
    },
    input() {
      if (timer !== null) arm()
    },
    reset: clear,
    dispose: clear,
  }
}
