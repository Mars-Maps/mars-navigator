import { lazy, Suspense, useMemo } from 'react'
import type { Classified, MarsCoordinate, RouteOption } from '../domain'
import { TerrainProfile3dPlotView, TerrainProfile3dView } from '../features/mission-ui/tools/TerrainProfile3d'
import { routeCaption, type RouteOnPlot } from '../features/mission-ui/tools/terrainProfile3dGate'
import { routeOnSurface } from '../features/mars-3d/terrainProfile/routeLine'
import { pathCrossesBox } from '../features/route-analysis/pathInBox'
import type { TerrainSurface } from '../features/route-analysis/terrainProfileGrid'
import { useMissionStore, useTerrainPoints } from '../state'
import { ErrorBoundary, FailedPart, LoadingPart } from './ErrorBoundary'
import { MovablePlot } from './terrainPlot/MovablePlot'

// Three.js stays out of the first load: the plot's canvas arrives when a surface is first shown.
const HeightfieldPlot = lazy(() =>
  import('../features/mars-3d/terrainProfile/HeightfieldPlot').then((m) => ({ default: m.HeightfieldPlot })),
)

/**
 * The Terrain Profile 3D tool's panel above the dock: the corners
 * the scene wrote to the store on each click, each with its pencil (the
 * next click moves it), and Clear, which drops them and puts the tool
 * away. The shell computes the surface once (`useTerrainSurface` in
 * `App`) and hands it here for the header's mark and to
 * `TerrainProfile3dPlot` for the plot. `App` clears the corners on every
 * change of tool, so no region is left on the globe with nothing
 * explaining it, even when this lazy panel never arrived.
 */
export function TerrainProfile3dPanel({ surface }: { surface: Classified<TerrainSurface> | null }) {
  const points = useTerrainPoints((s) => s.points)
  const replacing = useTerrainPoints((s) => s.replacing)
  const setReplacing = useTerrainPoints((s) => s.setReplacing)
  const clear = useTerrainPoints((s) => s.clearTerrainPoints)
  const setActiveTool = useMissionStore((s) => s.setActiveTool)
  return (
    <TerrainProfile3dView
      points={points}
      surface={surface}
      replacing={replacing}
      onReplace={setReplacing}
      onClear={() => {
        clear()
        setActiveTool(null)
      }}
    />
  )
}

/**
 * The plot in its movable box (`MovablePlot`: the user drags it by its
 * handle, and it steps aside while a menu is open over it): the surface's
 * frame while it loads, then the lazy canvas. While navigating, `route` is the followed
 * route (the store's `activeRoute`, so picking another strategy swaps it):
 * its path goes to the plot, drawn where it crosses the box, and the caption
 * says whether it does, by the same rule the plot draws by (`routeOnSurface`):
 * a route crossing the box only over holes is not drawn, and the caption
 * says that. Only a DERIVED path is drawn, as on the globe; a route without
 * one has nothing to draw and the caption says so.
 */
export function TerrainProfile3dPlot({ surface, route = null }: { surface: Classified<TerrainSurface> | null; route?: RouteOption | null }) {
  const path = useMemo(() => routePath(route), [route])
  const on: RouteOnPlot | null = useMemo(() => {
    if (route === null) return null
    if (path === null) return 'no-path'
    if (surface?.classification !== 'DERIVED') return null
    if (!pathCrossesBox(surface.value.grid, path)) return 'outside'
    return routeOnSurface(surface.value, path) ? 'crosses' : 'holes'
  }, [route, path, surface])
  const plot =
    surface?.classification === 'DERIVED' ? (
      <ErrorBoundary fallback={() => <FailedPart what="The 3D plot" panel />}>
        <Suspense fallback={<LoadingPart what="the 3D plot" />}>
          <HeightfieldPlot surface={surface.value} route={path} />
        </Suspense>
      </ErrorBoundary>
    ) : null
  if (surface === null) return null
  return (
    <MovablePlot>
      {(compact) => (
        <TerrainProfile3dPlotView
          surface={surface}
          plot={plot}
          routeNote={route !== null && on !== null ? routeCaption(route.strategy, on) : null}
          notesOpen={!compact}
        />
      )}
    </MovablePlot>
  )
}

/** The route's drawn line: its DERIVED path's coordinates, or null when it has none to draw. */
function routePath(route: RouteOption | null): MarsCoordinate[] | null {
  return route?.path.classification === 'DERIVED' ? route.path.value.map((p) => p.coordinate) : null
}
