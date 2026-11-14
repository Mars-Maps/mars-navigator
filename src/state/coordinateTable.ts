import type { MarsCoordinate } from '../domain'
import type { ViewMode } from './viewMode'

/**
 * What the coordinate table shows: `pick` is under the right-click,
 * DERIVED from the pick ray; `typed` is the user's own entry in the menu.
 */
export interface CoordinateTableState {
  point: MarsCoordinate
  source: 'pick' | 'typed'
}

/** The modes whose left column has the coordinate table's slot. */
export const TABLE_MODES: readonly ViewMode[] = ['close-up', 'navigation']
