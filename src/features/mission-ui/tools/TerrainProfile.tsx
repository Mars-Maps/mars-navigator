import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import type { Classified, MarsCoordinate } from '../../../domain'
import type { ElevationProfile } from '../../route-analysis/elevationProfile'
import { ElevationProfileBody, ProfileHeaderMarks } from '../navigation/ElevationProfilePanel'
import { TerrainPointList } from './TerrainPointList'
import { terrainProfileGate } from './terrainProfilePoints'

const POINT_NAMES = ['A', 'B']

/**
 * The Terrain Profile tool's panel: the elevation along the line
 * between two clicked points, drawn with the navigation chart. While
 * the tool is active the scene's left click sets A, then B, and draws the
 * line between them (`TerrainRegion`); a third click starts a new line
 * (as Measure does). A point's pencil makes the next click move it;
 * Clear drops both and puts the tool away.
 *
 * Renders from props. The shell reads the profile, since features do not
 * import each other: it reads the points from the store, gets the profile
 * from the same `useProfile` that feeds the navigation chart and
 * hands it here. While the shell samples, or when it cannot, the chart's
 * hatched frame says why, never a flat line.
 */
export function TerrainProfileView({
  points,
  profile,
  replacing = null,
  onReplace = () => {},
  onClear = () => {},
}: {
  /** A, then B, in click order: none, one or two. */
  points: readonly MarsCoordinate[]
  /** The profile between A and B; null below two points. */
  profile: Classified<ElevationProfile> | null
  /** The point the next click moves, from its pencil, or null. */
  replacing?: number | null
  onReplace?: (index: number) => void
  onClear?: () => void
}) {
  const gate = replacing !== null && replacing < points.length ? null : terrainProfileGate(points.length)
  // Minimising keeps the panel mounted; the points live in the store either way.
  const { minimized, toggle, bodyId } = useMinimized()

  // No ×: the dock's button closes a tool's panel.
  return (
    <Panel
      surface="glass"
      compact={minimized}
      className="max-h-[calc(100vh-10rem)] w-full overflow-y-auto"
    >
      <PanelHeader
        title="Terrain Profile"
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        spacing="mb-3"
      >
        <div className="flex items-center gap-1.5">
          <h2 className="text-heading font-semibold text-ink">Terrain Profile</h2>
          {/* Folded, an unavailable line keeps its mark, as the navigation chart's does. */}
          <ProfileHeaderMarks profile={profile} minimized={minimized} />
        </div>
      </PanelHeader>
      {minimized ? null : (
        <div id={bodyId} className="flex flex-col gap-3">
          <TerrainPointList
            points={points}
            names={(i) => POINT_NAMES[i] ?? String(i + 1)}
            replacing={replacing}
            onReplace={onReplace}
            onClear={onClear}
            label="Points"
          />
          {replacing !== null && replacing < points.length ? (
            <p className="text-body text-ink">Click the surface to move point {POINT_NAMES[replacing]}.</p>
          ) : gate !== null ? (
            <div>
              <p className="text-body text-ink">{gate}</p>
              <p className="mt-1 text-caption text-ink-subtle">A third click starts a new line.</p>
            </div>
          ) : (
            <>
              <p className="text-caption text-ink-subtle">Along the great-circle line from A to B</p>
              {/* Null for the first frame, until the shell has the pair. */}
              {profile && <ElevationProfileBody profile={profile} />}
            </>
          )}
        </div>
      )}
    </Panel>
  )
}
