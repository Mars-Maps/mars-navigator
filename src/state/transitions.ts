import { TABLE_MODES } from './coordinateTable'
import type { MissionState } from './missionStore'
import { canTransition, type ViewMode } from './viewMode'

/**
 * The view-mode moves the mission store makes, as pure functions of its
 * state: which fields a move writes, and where the surface view returns to.
 * Kept out of `missionStore.ts` for its 500-line limit.
 */

/**
 * The one place a view-mode change happens. Returns the fields to write,
 * or nothing when the move is not allowed. Entering welcome from another
 * mode brings the intro panel back; leaving surface clears the spot
 * and the drop note; a move outside close-up and navigation closes the
 * coordinate table.
 */
export function transitionTo(
  s: Pick<MissionState, 'viewMode'>,
  next: ViewMode,
): Partial<Pick<MissionState, 'viewMode' | 'introDismissed' | 'surfaceSpot' | 'surfaceNote' | 'coordinateTable'>> {
  if (next === s.viewMode || !canTransition(s.viewMode, next)) return {}
  return {
    viewMode: next,
    ...(next === 'welcome' ? { introDismissed: false } : {}),
    ...(s.viewMode === 'surface' ? { surfaceSpot: null, surfaceNote: null } : {}),
    ...(TABLE_MODES.includes(next) ? {} : { coordinateTable: null }),
  }
}

/** Where a surface entered from `s` returns to: navigation keeps its route; a teleport keeps the earlier answer. */
export function surfaceReturnFrom(s: Pick<MissionState, 'viewMode' | 'surfaceReturn'>): MissionState['surfaceReturn'] {
  if (s.viewMode === 'navigation') return 'navigation'
  if (s.viewMode === 'surface') return s.surfaceReturn
  return 'close-up'
}

/** The mode leaving the surface goes to: the remembered one, unless it was navigation and the route is gone meanwhile. */
export function surfaceLeaveTarget(s: Pick<MissionState, 'surfaceReturn' | 'activeRoute'>): ViewMode {
  return s.surfaceReturn === 'navigation' && s.activeRoute !== null ? 'navigation' : 'close-up'
}
