/**
 * The dock's macOS-style magnification, as pure maths so it can be
 * tested without a browser. Distances are in resting button pitches (one
 * button plus one gap), measured from the bar's centre, which stays put
 * while the bar grows because the slot centres it.
 */

/** Scale of the button right under the cursor. */
export const DOCK_MAX_SCALE = 1.5

/** Pitches from the cursor at which a button is back to its resting size. */
export const DOCK_REACH = 2.5

/**
 * A button's scale from its distance to the cursor. Cosine falloff: smooth
 * under the cursor, and it meets 1 at `DOCK_REACH` without a step.
 */
export function dockScale(distance: number): number {
  const d = Math.abs(distance)
  if (!Number.isFinite(d) || d >= DOCK_REACH) return 1
  return 1 + ((DOCK_MAX_SCALE - 1) * (Math.cos((Math.PI * d) / DOCK_REACH) + 1)) / 2
}

/**
 * Every button's scale for a cursor `offset` pitches from the bar's centre.
 * Measured against the resting layout, not the magnified one, so a growing
 * button never moves the point it is measured from and the dock does not
 * jitter. null (no cursor, no focus) leaves every button at rest.
 */
export function dockScales(offset: number | null, count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    offset === null ? 1 : dockScale(offset - restingOffset(i, count)),
  )
}

/** Button i's resting centre, in pitches from the bar's centre. */
export function restingOffset(index: number, count: number): number {
  return index - (count - 1) / 2
}
