/**
 * The pop-and-wobble a map pin plays when it appears, as a pure
 * function of its age so it can be tested without a renderer. Decorative
 * feedback only: nothing about the point it marks.
 */

/** After this the pin is at rest: scale 1, upright. */
export const PIN_ANIMATION_S = 0.9

/** The pop: grows from nothing to full size, overshooting a little. */
const GROW_S = 0.35
/** Standard ease-out-back constant: about 10% overshoot. */
const OVERSHOOT = 1.70158
/** The wobble: a damped swing about the tip. */
const WOBBLE_RAD = 0.3
const WOBBLE_HZ = 3
const WOBBLE_DECAY_S = 0.2

export interface PinPose {
  /** Size multiplier, 0 at birth, 1 at rest. */
  scale: number
  /** Swing about the tip, radians, 0 at rest. */
  angle: number
}

/**
 * The pose `ageS` seconds after the pin appeared, written into `out` so the
 * frame loop allocates nothing. Ages outside the animation (negative, NaN
 * or past PIN_ANIMATION_S) are at rest.
 */
export function pinPose(ageS: number, out: PinPose): PinPose {
  if (!(ageS >= 0) || ageS >= PIN_ANIMATION_S) {
    out.scale = 1
    out.angle = 0
    return out
  }
  const x = Math.min(ageS / GROW_S, 1) - 1
  out.scale = 1 + (OVERSHOOT + 1) * x ** 3 + OVERSHOOT * x ** 2
  out.angle =
    WOBBLE_RAD * Math.exp(-ageS / WOBBLE_DECAY_S) * Math.sin(2 * Math.PI * WOBBLE_HZ * ageS)
  return out
}
