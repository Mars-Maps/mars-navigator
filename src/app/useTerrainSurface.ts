import { useEffect, useMemo, useState } from 'react'
import { unavailable, type Classified } from '../domain'
import type { TerrainProfileCorners } from '../features/route-analysis/terrainProfile'
import { gridPointPairs, terrainProfileGrid, terrainSurface, type TerrainSurface } from '../features/route-analysis/terrainProfileGrid'
import { REFINING_GRID_NOTE, SAMPLING_GRID_REASON } from '../features/mission-ui/tools/terrainProfile3dGate'
import type { ProfileHeights } from './routeProfile'

/**
 * The ground between four corners, read from the elevation source,
 * for the Terrain Profile 3D tool, as `useProfile` reads a line. null with
 * no corners. Corners with no area answer at once with the reason;
 * otherwise UNAVAILABLE "sampling" until the read lands, and the read is
 * abandoned when the corners change. In Jezero a first surface from the
 * 20 m model shows while the 1 m one is read row by row, then is replaced
 * by it. Keyed by the corners' coordinates, so a new array with the
 * same points neither re-reads nor flickers.
 *
 * Imports only types from the shell's profile modules: a value import would
 * pull `elevationProfile` and its chart out of the entry into a shared
 * chunk and put the first load over 500 kB.
 */
export function useTerrainSurface(
  corners: TerrainProfileCorners | null,
  heights: ProfileHeights,
): Classified<TerrainSurface> | null {
  const key = corners === null ? null : cornersKey(corners)
  const grid = useMemo(() => {
    if (key === null) return null
    const c = cornersOf(key)
    return terrainProfileGrid(c, { cellKm: heights.cellKmAlong(c) })
  }, [key, heights])
  const [done, setDone] = useState<{ key: string; surface: Classified<TerrainSurface> } | null>(null)

  useEffect(() => {
    if (key === null || grid === null || grid.classification === 'UNAVAILABLE') return
    const controller = new AbortController()
    const show = (surface: Classified<TerrainSurface>) => {
      if (!controller.signal.aborted) setDone({ key, surface })
    }
    const first = (read: Parameters<typeof terrainSurface>[1]) => {
      const s = terrainSurface(grid, read, heights.noDataReason)
      show(s.classification === 'DERIVED' ? { ...s, method: `${s.method}; ${REFINING_GRID_NOTE}` } : s)
    }
    // The source never rejects past its own guards; if it ever does, the panel says so rather than staying on "sampling".
    heights
      .elevationsAt(gridPointPairs(grid.value), controller.signal, first)
      .then((read) => terrainSurface(grid, read, heights.noDataReason))
      .catch((error: unknown): Classified<TerrainSurface> => unavailable(error instanceof Error ? error.message : String(error)))
      .then(show)
    return () => controller.abort()
  }, [key, grid, heights])

  if (key === null || grid === null) return null
  if (grid.classification === 'UNAVAILABLE') return grid
  return done?.key === key ? done.surface : unavailable(SAMPLING_GRID_REASON)
}

/** The corners as one string: their coordinates, full precision. A number survives the round trip exactly. */
export function cornersKey(corners: TerrainProfileCorners): string {
  return corners.map((c) => `${c.latitude},${c.longitudeEast}`).join(';')
}

/** The corners a key names. */
export function cornersOf(key: string): TerrainProfileCorners {
  const [a, b, c, d] = key.split(';').map((pair) => {
    const [latitude, longitudeEast] = pair.split(',').map(Number)
    return { latitude, longitudeEast }
  })
  return [a, b, c, d]
}
