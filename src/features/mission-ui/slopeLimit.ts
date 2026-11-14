import { isAvailable, unavailable, type Classified, type Hazard, type SlopeLimit } from '../../domain'
import { describeSlope } from '../route-analysis/profileSlope'

/**
 * The plan's slope limit (`WalkPlan.slopeLimit`) as
 * the UI applies it, in the HUD and on the stop card: one
 * rule, so a slope flagged in one place is flagged in the other.
 */

/** The slope as shown: UNAVAILABLE rather than a figure that is not a slope. */
export function shownSlope(slope: Classified<number>): Classified<number> {
  if (!isAvailable(slope) || (Number.isFinite(slope.value) && slope.value >= 0)) return slope
  return unavailable('The slope is not a finite, unsigned number')
}

/**
 * Steeper than the planner's limit, by the planner's own rule: strictly
 * over it ("steeper than 20°"). An unknown slope is never over, and
 * the UI says it is unknown instead.
 */
export function isOverLimit(slope: Classified<number>, limit: SlopeLimit): boolean {
  const shown = shownSlope(slope)
  return isAvailable(shown) && shown.value > limit.deg
}

/**
 * The figure a leg's flag goes on: its steepest slope where the planner
 * knows it, else the steepest stretch the planner did measure. `walkLegs`
 * leaves the steepest UNAVAILABLE once any stretch went unchecked, even
 * with another already over the limit, which is then only in the leg's
 * slope hazards. A slope hazard with no figure was not checked, so it never
 * raises a flag.
 */
export function legSlopeToFlag(steepest: Classified<number>, hazards: Classified<Hazard[]>): Classified<number> {
  const shown = shownSlope(steepest)
  if (isAvailable(shown) || !isAvailable(hazards)) return shown
  const measured = hazards.value
    .filter((h) => h.kind === 'slope')
    .map((h) => shownSlope(h.magnitude))
    .filter((m) => isAvailable(m))
  return measured.reduce<Classified<number>>(
    (worst, m) => (isAvailable(worst) && worst.value >= m.value ? worst : m),
    shown,
  )
}

/** "12.4° moderate": the elevation chart's bands. */
export function formatSlope(deg: number): string {
  return describeSlope(deg) ?? `${deg.toFixed(1)}°`
}
