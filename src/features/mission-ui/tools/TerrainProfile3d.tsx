import type { ReactNode } from 'react'
import { ClassificationBadge, InfoMark } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import type { Classified, MarsCoordinate } from '../../../domain'
import type { TerrainSurface } from '../../route-analysis/terrainProfileGrid'
import { TerrainPointList } from './TerrainPointList'
import { SAMPLING_GRID_REASON, surfaceCaption, terrainProfile3dGate } from './terrainProfile3dGate'

/**
 * The Terrain Profile 3D tool's panel: the ground between four
 * clicked corners as a surface plot. While the tool is active the scene's
 * left click sets the next corner and draws the region (`TerrainRegion`); a
 * fifth click starts over. The gate (`terrainProfile3dGate`) says why the
 * tool is not ready; ready, the panel lists the corners in click order and
 * shows the plot the shell hands it, with where its heights came from.
 *
 * Renders from props. The shell reads the heights, since features do not
 * import each other, and builds `plot` from the surface (a lazy mars-3d
 * canvas); the view shows it only once the surface is here. While the
 * shell samples, or when it cannot, a hatched frame says why, never a flat
 * plane, which would read as level ground.
 */
export function TerrainProfile3dView({
  points,
  surface,
  replacing = null,
  onReplace = () => {},
  onClear = () => {},
}: {
  /** The corners in click order: none to four. */
  points: readonly MarsCoordinate[]
  /** The surface between the corners; null until the corners are ready. */
  surface: Classified<TerrainSurface> | null
  /** The corner the next click moves, from its pencil, or null. */
  replacing?: number | null
  onReplace?: (index: number) => void
  onClear?: () => void
}) {
  const { state, line } = terrainProfile3dGate(points)
  const moving = replacing !== null && replacing < points.length
  // Minimising keeps the panel mounted.
  const { minimized, toggle, bodyId } = useMinimized()

  // No ×: the dock's button closes a tool's panel.
  return (
    <Panel surface="glass" compact={minimized} className="max-h-[calc(100vh-10rem)] w-full overflow-y-auto">
      <PanelHeader title="Terrain Profile 3D" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId} spacing="mb-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-heading font-semibold text-ink">Terrain Profile 3D</h2>
          {/* Folded, an unavailable surface keeps its mark, as the profile charts do. */}
          <SurfaceHeaderMark surface={surface} minimized={minimized} />
        </div>
      </PanelHeader>
      {minimized ? null : (
        <div id={bodyId} className="flex flex-col gap-3">
          <TerrainPointList
            points={points}
            names={(i) => String(i + 1)}
            replacing={replacing}
            onReplace={onReplace}
            onClear={onClear}
            label="Corners"
          />
          {moving ? (
            <p className="text-body text-ink">Click the surface to move corner {replacing + 1}.</p>
          ) : line !== null ? (
            <p className="flex items-start gap-1.5 text-body text-ink">
              <span>{line}</span>
              <InfoMark
                detail={
                  state.status === 'disabled'
                    ? 'Each click sets the next corner, in order around the region; a fifth click starts over.'
                    : "Use a corner's pencil to move it, or click the corners again in order around the region."
                }
              />
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-ink-subtle">
              {surface === null || surface.classification === 'UNAVAILABLE' ? 'Waiting for the heights' : 'The plot is in its own box'}
              <InfoMark
                detail={
                  surface === null || surface.classification === 'UNAVAILABLE'
                    ? 'The plot, in its own box, is waiting for the heights. Drag the box by its handle to move it.'
                    : 'The plot is in its own box: drag inside it to orbit, scroll to zoom, drag its handle to move it.'
                }
              />
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * What the plot's box shows (the shell puts it in a box the user can move):
 * nothing until the corners are ready; the hatched frame while the heights
 * are read or when there are none; then the plot the shell hands over, on a
 * transparent box so the ground shows through, with its notes under it on
 * glass so they read over any terrain: the caption, folded under one line
 * unless `notesOpen` (the box is compact on a small screen), and, while a
 * route is followed, the line about the route (`routeCaption`), always shown.
 */
export function TerrainProfile3dPlotView({
  surface,
  plot,
  routeNote = null,
  notesOpen = true,
}: {
  surface: Classified<TerrainSurface> | null
  /** The plot of an available surface, from the shell. */
  plot: ReactNode
  /** The followed route's line for the caption, or null when none is followed. */
  routeNote?: string | null
  /** Whether the caption starts unfolded; the user folds and unfolds it either way. */
  notesOpen?: boolean
}) {
  if (surface === null) return null
  if (surface.classification === 'UNAVAILABLE') return <UnavailableFrame reason={surface.reason} />
  return (
    <div className="flex flex-col gap-1">
      {plot}
      <div className="rounded-control border border-line bg-surface/80 px-2 py-1 text-caption text-ink-muted backdrop-blur-glass">
        <details open={notesOpen}>
          <summary className="cursor-pointer select-none text-ink">About these heights</summary>
          <p className="mt-0.5">{surfaceCaption(surface.value)}</p>
        </details>
        {routeNote !== null && <p className="mt-0.5 text-ink">{routeNote}</p>}
      </div>
    </div>
  )
}

/**
 * The surface's provenance beside the heading. Open, an unavailable surface
 * says so in the body; minimised, the bar keeps the UNAVAILABLE mark, so a
 * folded panel never hides that there is no data.
 */
function SurfaceHeaderMark({ surface, minimized }: { surface: Classified<TerrainSurface> | null; minimized: boolean }) {
  if (!surface) return null
  if (surface.classification === 'UNAVAILABLE') {
    return minimized ? <ClassificationBadge classification="UNAVAILABLE" detail={surface.reason} /> : null
  }
  return (
    <ClassificationBadge
      classification={surface.classification}
      detail={surface.classification === 'DERIVED' ? surface.method : surface.source}
    />
  )
}

/**
 * The plot's height (`--plot-h`, from its box; 15 rem without one), so the box keeps its shape when the heights arrive. A
 * hatched box, not a plane: nothing that could read as level ground. While
 * the heights are still being read it says "loading": no data yet, but not
 * a dead end.
 */
function UnavailableFrame({ reason }: { reason: string }) {
  return (
    <p className="flex h-(--plot-h,15rem) items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong bg-[repeating-linear-gradient(135deg,var(--color-line)_0_1px,transparent_1px_8px)] text-body text-ink-muted [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]">
      {reason === SAMPLING_GRID_REASON ? 'Heights loading…' : 'Heights unavailable'}
      <ClassificationBadge classification="UNAVAILABLE" detail={reason} />
    </p>
  )
}
