import type { TraversePoint } from '../../domain'
import type { ViewMode } from '../../state'

/**
 * Sols along the rover's driven path, in plain arithmetic: kept
 * apart from traverseGeometry, which needs Three.js, so the shell's
 * caption and slider can read them without pulling the renderer into the
 * first load.
 */

/** The first and last sol in the feed, or null for an empty one. */
export function solRange(points: readonly TraversePoint[]): { first: number; last: number } | null {
  if (points.length === 0) return null
  return { first: points[0].sol, last: points[points.length - 1].sol }
}

/**
 * How many waypoints, from the first, were reached by the end of `sol`.
 * Binary search, so a slider drag costs nothing per step. Relies on sols
 * never decreasing along the feed, which the adapter checks.
 */
export function pointsThroughSol(points: readonly TraversePoint[], sol: number): number {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid].sol <= sol) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Whether the sol slider shows. It sits over the canvas, outside the shell's
 * slots, so it follows their rules itself: not on the welcome globe, where
 * the path is a few pixels wide, not under "Hide all tools", and not while a
 * tool panel would cover it.
 */
export function solSliderShown(viewMode: ViewMode, toolsHidden: boolean, activeToolId: string | null): boolean {
  return viewMode !== 'welcome' && !toolsHidden && activeToolId === null
}
