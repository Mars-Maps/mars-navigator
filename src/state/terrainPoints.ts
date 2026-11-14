import { create } from 'zustand'
import type { MarsCoordinate } from '../domain'
import { MEASURE_TOOL_ID } from './measure'

/** The two profile tools' ids in the dock, which the scene compares `activeToolId` with. */
export const TERRAIN_PROFILE_TOOL_ID = 'terrain-profile'
export const TERRAIN_PROFILE_3D_TOOL_ID = 'terrain-profile-3d'

/** How many clicks each profile tool takes: a line's two ends, a region's four corners. */
export const TERRAIN_POINT_LIMIT: Readonly<Record<string, number>> = {
  [TERRAIN_PROFILE_TOOL_ID]: 2,
  [TERRAIN_PROFILE_3D_TOOL_ID]: 4,
}

/** The points the active profile tool takes, or null when the active tool is not one. */
export function terrainPointLimit(toolId: string | null): number | null {
  return toolId === null ? null : (TERRAIN_POINT_LIMIT[toolId] ?? null)
}

/** Whether a left click on the globe sets a point for the active tool: Measure or a profile tool. */
export function toolTakesClicks(toolId: string | null): boolean {
  return toolId === MEASURE_TOOL_ID || terrainPointLimit(toolId) !== null
}

/**
 * The points after a click: appended in order up to `limit`, and a click
 * past the limit starts over at the clicked point, as Measure does. While a
 * point is being changed (`replacing`, its index, from the panel's pencil)
 * the click moves that point instead and the others stay.
 */
export function nextTerrainPoints(
  points: readonly MarsCoordinate[],
  point: MarsCoordinate,
  limit: number,
  replacing: number | null = null,
): readonly MarsCoordinate[] {
  if (replacing !== null && replacing >= 0 && replacing < points.length) {
    return points.map((p, i) => (i === replacing ? point : p))
  }
  return points.length >= limit ? [point] : [...points, point]
}

/**
 * The profile tools' clicked points: the Terrain Profile's A
 * and B, or the Terrain Profile 3D's corners 1 to 4, in click order. Its
 * own store, like Measure's, so missionStore stays under its line limit:
 * the scene writes a point on each click while a profile tool is active
 * and draws the line or the region; the panel reads them. Empty whenever
 * neither tool is in use: the panel clears the store when it unmounts.
 */
export interface TerrainPointsState {
  points: readonly MarsCoordinate[]
  /** The index of the point the next click moves, from the panel's pencil; null to append as usual. */
  replacing: number | null
  addTerrainPoint: (point: MarsCoordinate, limit: number) => void
  /** Pencil: the next click moves this point; the same index again, or null, cancels. */
  setReplacing: (index: number | null) => void
  clearTerrainPoints: () => void
}

const NONE: readonly MarsCoordinate[] = []

export const useTerrainPoints = create<TerrainPointsState>()((set) => ({
  points: NONE,
  replacing: null,
  addTerrainPoint: (point, limit) =>
    set((s) => ({ points: nextTerrainPoints(s.points, point, limit, s.replacing), replacing: null })),
  setReplacing: (index) => set((s) => ({ replacing: s.replacing === index ? null : index })),
  // Leaves an empty store alone, so a release with nothing set renders nothing.
  clearTerrainPoints: () =>
    set((s) => (s.points.length === 0 && s.replacing === null ? s : { points: NONE, replacing: null })),
}))
