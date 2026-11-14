/**
 * The Terrain Profile tool's two clicked points (clicks,
 * not marked points): A then B, from the `useTerrainPoints` store the
 * scene writes while the tool is active. A third click starts a new line.
 */

/** A line takes two points. */
export const TERRAIN_PROFILE_LINE_POINTS = 2

/** What the panel asks for below two points, in Measure's words; null when there are two. */
export function terrainProfileGate(count: number): string | null {
  if (count >= TERRAIN_PROFILE_LINE_POINTS) return null
  return `Click the surface to set point ${count === 0 ? 'A' : 'B'}.`
}
