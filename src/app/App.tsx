import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadLandingEllipse } from '../data/adapters/SiteAdapter'
import { GALE_RAD_REFERENCE } from '../data/radiation/galeRadReference'
import { DEFAULT_SITE } from '../data/sites/sites'
import { CAMERA_FOV_DEG } from '../features/mars-3d/constants'
import { altitudeToFrame, altitudeToFrameBounds } from '../features/mars-3d/framing'
import { SurfaceCaption } from '../features/mars-3d/SurfaceCaption'
import { globalGroundImagery } from '../features/mars-3d/surfaceDetail'
import { Compass } from '../features/mission-ui/CompassDial'
import { ContextMenu } from '../features/mission-ui/ContextMenu'
import { HoverReadout } from '../features/mission-ui/HoverReadout'
import { IconPanel } from '../features/mission-ui/IconPanel'
import { IntroPanel } from '../features/mission-ui/IntroPanel'
import { PointMenu } from '../features/mission-ui/PointMenu'
import { ScaleBar } from '../features/mission-ui/ScaleBar'
import { SearchBar } from '../features/mission-ui/SearchBar'
import { SetPointChooser } from '../features/mission-ui/SetPointChooser'
import { TimeMenu } from '../features/mission-ui/TimeMenu'
import { ToolDock } from '../features/mission-ui/tools/ToolDock'
import { startMissionClock, TERRAIN_PROFILE_3D_TOOL_ID, useMissionStore, useSite, useTerrainPoints, useWalkPlan } from '../state'
import { INTRO_CONSTANTS } from './introConstants'
import { AppLayout } from './layout/AppLayout'
import { ErrorBoundary, FailedPart, LoadingPart } from './ErrorBoundary'
import { profileHeights, surfaceElevation } from './elevation'
import { routeTerrain } from './routeTerrain'
import { useRoutePlanner } from './useRoutePlanner'
import { WALK_ROUTE_STRATEGIES } from './walkNavigation'
import { pathOfRoute } from './routeProfile'
import { useSampleWalkPlan } from './sampleWalk'
import { SampleWalkBanner } from './SampleWalkBanner'
import { useGeologicUnits } from './useGeologicUnits'
import { useProfile } from './useProfile'
import { useMeasuredTemperature } from './useMeasuredTemperature'
import { useRoverTraverse } from './useRoverTraverse'
import { useSelectedGeologicUnit } from './useSelectedGeologicUnit'
import { useSlopeAt } from './useSelectedSlope'
import { useSelectedShielding } from './useSelectedShielding'
import { useGroundImagery, useSurfaceLayers } from './useSurfaceLayers'
import { useTemperatureModel } from './useTemperatureModel'
import { useTerrainSurface } from './useTerrainSurface'
import { terrainProfile3dGate } from '../features/mission-ui/tools/terrainProfile3dGate'
import { useViewModeTriggers } from './viewModeTriggers'

// The site the app opens on: the one entry the shell names.
const SITE = DEFAULT_SITE

// Three.js and the scene load in their own chunk, so the panels show
// before it arrives; until then the scene slot is empty over the shell's
// background, the same colour the globe sits on.
const MarsGlobe = lazy(() =>
  import('../features/mars-3d/MarsGlobe').then((m) => ({ default: m.MarsGlobe })),
)

// Only shown standing on the surface with a plan, so out of the first load.
const WalkHud = lazy(() => import('./SurfaceWalkPanels').then((m) => ({ default: m.WalkHud })))
const WalkStopCard = lazy(() => import('./SurfaceWalkPanels').then((m) => ({ default: m.WalkStopCard })))
// Only shown with the Rover photos tool open, so the strip and its search load then.
const WalkRoverPhotos = lazy(() => import('./WalkRoverPhotos').then((m) => ({ default: m.WalkRoverPhotos })))
// Only shown with the Terrain Profile 3D tool open: the panel and the plot's frame load then, the canvas after; the gate and grid are read here, since the surface feeds both.
const TerrainProfile3dPanel = lazy(() => import('./TerrainProfile3dPanel').then((m) => ({ default: m.TerrainProfile3dPanel })))
const TerrainProfile3dPlot = lazy(() => import('./TerrainProfile3dPanel').then((m) => ({ default: m.TerrainProfile3dPlot })))
// Only shown with Plan a walk open: lazy like Rover photos, so the first load stays under 500 kB with the dock's seventh tool.
const WalkPlannerPanel = lazy(() => import('./WalkPlannerPanel').then((m) => ({ default: m.WalkPlannerPanel })))
// Search & Go To in its own chunk, so the first load stays under its budget.
// Shown only while their tool or table is open, so they stay out of the first load.
const TerrainProfilePanel = lazy(() => import('./TerrainProfilePanel').then((m) => ({ default: m.TerrainProfilePanel })))
const CoordinateTable = lazy(() =>
  import('../features/mission-ui/CoordinateTablePanel').then((m) => ({ default: m.CoordinateTable })),
)
const SearchGoToPanel = lazy(() => import('./SearchGoToPanel').then((m) => ({ default: m.SearchGoToPanel })))

// The four navigation panels show only while a route is followed, so they load when navigation starts.
const DestinationBar = lazy(() => import('./NavigationPanels').then((m) => ({ default: m.DestinationBar })))
const HazardsPanel = lazy(() => import('./NavigationPanels').then((m) => ({ default: m.HazardsPanel })))
const ElevationProfileView = lazy(() => import('./NavigationPanels').then((m) => ({ default: m.ElevationProfileView })))
const ProgressTracker = lazy(() => import('./NavigationPanels').then((m) => ({ default: m.ProgressTracker })))

export default function App() {
  // The route being navigated. Panels stay prop-driven and pure.
  const activeRoute = useMissionStore((s) => s.activeRoute)
  const routeOptions = useMissionStore((s) => s.routeOptions)
  const planRoute = useRoutePlanner(routeTerrain)
  const selectRouteOption = useMissionStore((s) => s.selectRouteOption)
  const endNavigation = useMissionStore((s) => s.endNavigation)
  // Read here, not in the panel, from the one elevation source.
  const routePath = useMemo(() => pathOfRoute(activeRoute), [activeRoute])
  const profile = useProfile(routePath, profileHeights)
  // The selected point's height and the atmosphere overhead derived from it,
  // for the point menu.
  const pointRead = useSelectedShielding()
  // The selected point's USGS geologic unit, for the point menu's row.
  const pointUnit = useSelectedGeologicUnit()
  // The point menu's temperature: the model bound to that same read,
  // so the pressure and the Elevation row agree, and the rovers'
  // measured ground temperatures at Jezero and Gale.
  const selectedPoint = useMissionStore((s) => s.selectedPoint)
  const temperatureModel = useTemperatureModel(pointRead, selectedPoint)
  // The selected point's slope from the heights around it, the stop
  // card's read, for the point menu's row since the Site Inspector left.
  const pointSlope = useSlopeAt(selectedPoint)
  const measuredTemperature = useMeasuredTemperature()
  // The profile tools' points clear on every change of tool, here
  // rather than in their panels: the scene writes a click from the moment the
  // tool is active, before a lazy panel has arrived, so this is the one place
  // that never misses the switch. The 3D tool's surface is read once here for
  // both its panel above the dock and its plot in its movable box.
  const activeToolId = useMissionStore((s) => s.activeToolId)
  const clearTerrainPoints = useTerrainPoints((s) => s.clearTerrainPoints)
  useEffect(() => clearTerrainPoints(), [activeToolId, clearTerrainPoints])
  const terrainCorners = activeToolId === TERRAIN_PROFILE_3D_TOOL_ID
  const terrainPoints = useTerrainPoints((s) => s.points)
  const terrainState = useMemo(() => (terrainCorners ? terrainProfile3dGate(terrainPoints).state : null), [terrainCorners, terrainPoints])
  const terrainSurface = useTerrainSurface(terrainState?.status === 'ready' ? terrainState.request.corners : null, profileHeights)
  // Layer catalogue and the active layer's image into the store;
  // the detail-tile loader goes to the scene as a prop.
  const detail = useSurfaceLayers()
  // CTX brightness for the surface view's ground, under the satellite layer.
  const groundImagery = useGroundImagery()
  // The detailed Jezero units for the geology layer, read when it is first chosen.
  const geology = useGeologicUnits(SITE.site.bounds)
  // Perseverance's driven path at Jezero, the site the app opens on.
  const traverse = useRoverTraverse('perseverance')
  // Welcome ↔ close-up: a click leaves welcome, a zoom-out to the whole globe
  // plus ten idle seconds returns to it. Navigation is a route's business.
  useViewModeTriggers()
  // Zoom of the detail tiles on screen, reported by the scene for the
  // caption slot; held here so the store stays out of it.
  const [detailZoom, setDetailZoom] = useState<number | null>(null)
  // And of the finer ground below the layer's own tiles: the global CTX mosaic, under the satellite layer.
  const [groundZoom, setGroundZoom] = useState<number | null>(null)
  const globalGround = globalGroundImagery(groundImagery)
  // The coordinate table's panel is mounted only while it is open.
  const tableOpen = useMissionStore((s) => s.coordinateTable !== null)
  // The mission clock ticks once a second while it runs.
  useEffect(startMissionClock, [])
  // The site into its store with the altitude that frames it, and its
  // landing ellipse read once; a read abandoned on unmount writes
  // nothing. Only the Go to button flies there.
  useEffect(() => {
    useSite.getState().setSite(SITE.site, altitudeToFrameBounds(SITE.site.bounds))
    const controller = new AbortController()
    loadLandingEllipse(SITE.ellipse, controller.signal).then((ellipse) => {
      if (!controller.signal.aborted) useSite.getState().setEllipse(ellipse)
    })
    return () => controller.abort()
  }, [])
  // `?sampleWalk` loads a SIMULATED walk plan for trying the walk views on chosen stops.
  const sampleWalk = useSampleWalkPlan()

  const pointMenu = (
    <PointMenu
      temperatureModel={temperatureModel}
      measuredTemperature={measuredTemperature}
      radiationReference={GALE_RAD_REFERENCE}
      radiationShielding={pointRead?.shielding ?? null}
      pointElevation={pointRead?.elevation ?? null}
      pointSlope={pointSlope}
      pointGeologicUnit={pointUnit}
    />
  )

  return (
    <AppLayout
      panels={{
        scene: (
          // A failed globe or surface chunk, or a render error, leaves the panels working.
          <ErrorBoundary fallback={() => <FailedPart what="The 3D view" />}>
            <Suspense fallback={null}>
              <MarsGlobe
                detail={detail}
                groundImagery={groundImagery}
                elevation={surfaceElevation}
                onDetailZoom={setDetailZoom}
                onGroundZoom={setGroundZoom}
                geology={geology.classification === 'OFFICIAL' ? geology.value : null}
                traverse={traverse.classification === 'OFFICIAL' ? traverse.value : null}
              />
            </Suspense>
          </ErrorBoundary>
        ),
        caption: (
          <SurfaceCaption
            detail={detail}
            detailZoom={detailZoom}
            ground={globalGround && groundZoom !== null ? { imagery: globalGround, zoom: groundZoom } : null}
            geology={geology}
            traverse={traverse}
          />
        ),
        intro: <IntroPanel constants={INTRO_CONSTANTS} />,
        pointMenu,
        scaleBar: <ScaleBar fovDeg={CAMERA_FOV_DEG} />,
        iconPanel: <IconPanel />,
        compass: <Compass />,
        hud: (
          <ErrorBoundary fallback={() => <FailedPart what="The walk guide" panel />}>
            <Suspense fallback={null}>
              <WalkHud routeProfile={profile} />
            </Suspense>
          </ErrorBoundary>
        ),
        stopCard: (
          <ErrorBoundary fallback={() => <FailedPart what="The stop card" panel />}>
            <Suspense fallback={null}>
              <WalkStopCard routeProfile={profile} />
            </Suspense>
          </ErrorBoundary>
        ),
        search: <SearchBar onPlan={planRoute} />,
        time: <TimeMenu />,
        terrainPlot: terrainSurface === null ? null : (
          <ErrorBoundary fallback={() => <FailedPart what="The 3D plot" panel />}>
            <Suspense fallback={null}>
              <TerrainProfile3dPlot surface={terrainSurface} route={activeRoute} />
            </Suspense>
          </ErrorBoundary>
        ),
        toolDock: (
          <ToolDock
            panels={{
              'plan-walk': (
                <ErrorBoundary fallback={() => <FailedPart what="Plan a walk" panel />}>
                  <Suspense fallback={<LoadingPart what="the walk planner" />}>
                    <WalkPlannerPanel onNavigate={(request) => planRoute(request, WALK_ROUTE_STRATEGIES)} />
                  </Suspense>
                </ErrorBoundary>
              ),
              'rover-photos': (
                <ErrorBoundary fallback={() => <FailedPart what="Rover photos" panel />}>
                  <Suspense fallback={<LoadingPart what="the rover photos" />}>
                    <WalkRoverPhotos />
                  </Suspense>
                </ErrorBoundary>
              ),
              'terrain-profile': (
                <ErrorBoundary fallback={() => <FailedPart what="Terrain Profile" panel />}>
                  <Suspense fallback={<LoadingPart what="Terrain Profile" />}>
                    <TerrainProfilePanel />
                  </Suspense>
                </ErrorBoundary>
              ),
              'terrain-profile-3d': (
                <ErrorBoundary fallback={() => <FailedPart what="Terrain Profile 3D" panel />}>
                  <Suspense fallback={<LoadingPart what="Terrain Profile 3D" />}>
                    <TerrainProfile3dPanel surface={terrainSurface} />
                  </Suspense>
                </ErrorBoundary>
              ),
              search: (
                <ErrorBoundary fallback={() => <FailedPart what="Search & Go To" panel />}>
                  <Suspense fallback={<LoadingPart what="Search & Go To" />}>
                    <SearchGoToPanel altitudeToFrame={altitudeToFrame} />
                  </Suspense>
                </ErrorBoundary>
              ),
            }}
          />
        ),
        destination: (
          <NavigationPart what="Destination" loading>
            <DestinationBar
              route={activeRoute}
              options={routeOptions}
              onSelect={selectRouteOption}
              onEnd={endNavigation}
            />
          </NavigationPart>
        ),
        hazards: (
          <NavigationPart what="Hazards">
            <HazardsPanel route={activeRoute} />
          </NavigationPart>
        ),
        elevationProfile: (
          <NavigationPart what="Elevation profile">
            <ElevationProfileView profile={profile} />
          </NavigationPart>
        ),
        progress: (
          <NavigationPart what="Progress">
            <ProgressTracker route={activeRoute} />
          </NavigationPart>
        ),
        // Mounted only while open, so its chunk loads with the first Expand.
        coordinateTable: tableOpen ? (
          <ErrorBoundary fallback={() => <FailedPart what="The coordinate table" panel />}>
            <Suspense fallback={null}>
              <CoordinateTable />
            </Suspense>
          </ErrorBoundary>
        ) : null,
      }}
    >
      <ContextMenu fovDeg={CAMERA_FOV_DEG} />
      <SetPointChooser />
      <HoverReadout />
      <SampleWalkBanner
        active={sampleWalk}
        text="Sample walk: stops picked by hand. Not a plan."
        onClear={() => useWalkPlan.getState().clearWalkPlan()}
      />
    </AppLayout>
  )
}

/**
 * A navigation panel in its lazy chunk, with a message if it fails. The four
 * arrive together, so only the first (`loading`) says so while they load:
 * the column is never blank, and never four loading lines.
 */
function NavigationPart({ what, loading = false, children }: { what: string; loading?: boolean; children: ReactNode }) {
  return (
    <ErrorBoundary fallback={() => <FailedPart what={what} panel />}>
      <Suspense fallback={loading ? <LoadingPart what="the navigation panels" /> : null}>{children}</Suspense>
    </ErrorBoundary>
  )
}
