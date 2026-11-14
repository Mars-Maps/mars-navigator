/**
 * The surface view's movement arithmetic: pure, allocation-free
 * functions the frame loop calls, so walking and flying are tested without
 * a renderer. Positions are patch-local metres, x east and y north; yaw 0
 * looks north and turns right towards east; pitch is positive looking up.
 */

export type MoveMode = 'walk' | 'fly'

/** The walker's eye above the ground. */
export const EYE_HEIGHT_M = 1.7
/** Walking's highest eye: a hover, still riding the terrain. */
export const MAX_EYE_HEIGHT_M = 3000
/** Flying never goes nearer the ground than this: the eye height, so Fly then Land returns where it started. */
export const MIN_CLEARANCE_M = EYE_HEIGHT_M
/** Flying's ceiling above the ground. */
export const MAX_FLY_ABOVE_M = 10_000
export const MAX_SPEED_M_S = 2000

export interface MoveKeys {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  run: boolean
}

export interface Move {
  dx: number
  dy: number
  /** Change in altitude; always 0 when walking. */
  dz: number
}

/** Metres per second for a given height above the ground, in either mode. Sped up, and faster the higher. */
export function speedFor(aboveGroundM: number, run: boolean): number {
  return Math.min(MAX_SPEED_M_S, Math.max(40, aboveGroundM * 1.5) * (run ? 5 : 1))
}

/**
 * The step for one frame. Walking moves level along the yaw; flying moves
 * along the look direction, with Space and C for straight up and down.
 * Diagonals are not faster than straight lines. `out` is filled in place.
 */
export function moveStep(
  mode: MoveMode,
  keys: MoveKeys,
  yaw: number,
  pitch: number,
  speedMps: number,
  dtS: number,
  out: Move,
): Move {
  const ahead = Number(keys.forward) - Number(keys.back)
  const side = Number(keys.right) - Number(keys.left)
  const lift = mode === 'fly' ? Number(keys.up) - Number(keys.down) : 0
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  if (mode === 'walk') {
    const n = Math.hypot(ahead, side)
    const step = n === 0 ? 0 : (speedMps * dtS) / n
    out.dx = (ahead * sin + side * cos) * step
    out.dy = (ahead * cos - side * sin) * step
    out.dz = 0
    return out
  }
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const vx = ahead * sin * cp + side * cos
  const vy = ahead * cos * cp - side * sin
  const vz = ahead * sp + lift
  const n = Math.hypot(vx, vy, vz)
  const step = n === 0 ? 0 : (speedMps * dtS) / n
  out.dx = vx * step
  out.dy = vy * step
  out.dz = vz * step
  return out
}

/** A flying altitude kept between the clearance floor and the ceiling over `groundM`. */
export function clampAltitude(altitudeM: number, groundM: number): number {
  return Math.max(groundM + MIN_CLEARANCE_M, Math.min(groundM + MAX_FLY_ABOVE_M, altitudeM))
}

/** A walking eye height kept within walking's limits. */
export function clampEye(eyeM: number): number {
  return Math.max(EYE_HEIGHT_M, Math.min(MAX_EYE_HEIGHT_M, eyeM))
}

/** The wheel's effect: a log-scale amount applied to the height above ground. */
export function scaledAbove(aboveM: number, wheelLog: number): number {
  return aboveM * Math.exp(wheelLog)
}
