import { useMemo } from 'react'
import { TerrainProfileView } from '../features/mission-ui/tools/TerrainProfile'
import { useMissionStore, useTerrainPoints } from '../state'
import { profileHeights } from './elevation'
import { useProfile } from './useProfile'

/**
 * The Terrain Profile tool with its heights: the scene
 * writes A and B to the store on each click while the tool is active; the
 * shell reads the profile between them, as it does for the route being
 * navigated, and hands it to the view. A point's pencil makes the next
 * click move it; Clear drops both and puts the tool away. `App` clears the
 * points on every change of tool, so no line is left on the globe with
 * nothing explaining it.
 */
export function TerrainProfilePanel() {
  const points = useTerrainPoints((s) => s.points)
  const replacing = useTerrainPoints((s) => s.replacing)
  const setReplacing = useTerrainPoints((s) => s.setReplacing)
  const clear = useTerrainPoints((s) => s.clearTerrainPoints)
  const setActiveTool = useMissionStore((s) => s.setActiveTool)
  const path = useMemo(() => (points.length >= 2 ? [points[0], points[1]] : null), [points])
  const profile = useProfile(path, profileHeights)
  return (
    <TerrainProfileView
      points={points}
      profile={profile}
      replacing={replacing}
      onReplace={setReplacing}
      onClear={() => {
        clear()
        setActiveTool(null)
      }}
    />
  )
}
