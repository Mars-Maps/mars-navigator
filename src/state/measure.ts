import { create } from 'zustand'
import type { MarsCoordinate } from '../domain'

/** The Measure tool's id in the dock, which the scene compares `activeToolId` with. */
export const MEASURE_TOOL_ID = 'measure'

/**
 * The Measure tool's two points. Its own store, like the surface
 * heading, so missionStore stays under the 500-line limit: the scene writes
 * the points while the tool is active, the panel reads them and the scene
 * draws the line. Empty whenever the tool is not in use.
 */
export interface MeasureState {
  /** In click order: none, A, or A and B. */
  points: readonly MarsCoordinate[]
  addMeasurePoint: (point: MarsCoordinate) => void
  clearMeasure: () => void
}

/**
 * The points after a click: the first click is A, the second B, and a third
 * starts a new measurement at the clicked point.
 */
export function nextMeasurePoints(
  points: readonly MarsCoordinate[],
  point: MarsCoordinate,
): readonly MarsCoordinate[] {
  return points.length >= 2 ? [point] : [...points, point]
}

const NONE: readonly MarsCoordinate[] = []

export const useMeasure = create<MeasureState>()((set) => ({
  points: NONE,
  addMeasurePoint: (point) => set((s) => ({ points: nextMeasurePoints(s.points, point) })),
  // Leaves an empty store alone, so a release with nothing measured renders nothing.
  clearMeasure: () => set((s) => (s.points.length === 0 ? s : { points: NONE })),
}))
