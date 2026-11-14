import type { MarsCoordinate } from '../../../domain'

/** Where a planned walk starts, and which of the user's points it is. */
export interface WalkStart {
  coordinate: MarsCoordinate
  from: 'departure' | 'selected point'
}

/**
 * The walk starts at the departure set in the search bar, else at the point
 * last set from the right-click menu; with neither there is no start, and
 * the picker asks for one.
 */
export function walkStart(departure: MarsCoordinate | null, selected: MarsCoordinate | null): WalkStart | null {
  if (departure) return { coordinate: departure, from: 'departure' }
  if (selected) return { coordinate: selected, from: 'selected point' }
  return null
}
