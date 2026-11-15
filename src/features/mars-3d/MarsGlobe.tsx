import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  CanvasTexture,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Mesh,
  type Texture,
} from 'three'
import type { GeologicUnitArea, MarsCoordinate, RoverTraverse } from '../../domain'
import {
  MEASURE_TOOL_ID,
  NO_DATA_HEX,
  terrainPointLimit,
  useMeasure,
  useMissionStore,
  useRoutePick,
  useSite,
  useTerrainPoints,
  type SurfaceImage,
} from '../../state'
import { CameraController } from './CameraController'
import { CoordinateGrid } from './CoordinateGrid'
import {
  CAMERA_FOV_DEG,
  DEG_TO_RAD,
  DEMO_SPIN_RAD_PER_S,
  GROUND_BELOW_ALTITUDE_KM,
  GLOBE_RADIUS,
  MARS_AXIAL_TILT_DEG,
  START_CAMERA_DISTANCE_RADII,
} from './constants'
import { easeStep } from './cameraMath'
import { GeologyOverlay } from './GeologyOverlay'
import { GridLabelBridge } from './gridLabelBridge'
import { GridLabels, GridLabelTracker } from './GridLabels'
import { pinAtClick } from './pinHit'
import { overlayLift, pickCoordinate, ROUTE_LIFT as PIN_LIFT } from './overlayLift'
import { coordinateToLocalPoint, spinToFace } from './projection'
import { draftWaypoints } from './routeWaypoints'
import { isMeasureClick, menuOpenAtPress } from './measureClick'
import { MeasureLine } from './MeasureLine'
import { GridDrape } from './GridDrape'
import { TerrainRegion } from './TerrainRegion'
import { HoverPick } from './HoverPick'
import { LandingColours } from './LandingColours'
import { LandingEllipse } from './LandingEllipse'
import { SiteLabel, SiteLabelTracker } from './SiteLabel'
import { PerfProbe } from './PerfProbe'
import { isPerfEnabled } from './perfReport'
import { RouteOverlay } from './RouteOverlay'
import { RoverTraverseOverlay, type TraverseHover } from './RoverTraverseOverlay'
import { TraverseControls } from './TraverseControls'
import { useTraverseSol } from './useTraverseSol'
import { Starfield } from './Starfield'
import { SunLight } from './SunLight'
import { globalGroundImagery, type GroundImagery, type SurfaceDetail } from './surfaceDetail'
import { GROUND_LIFT, GROUND_TILE_CAP, SurfaceTiles } from './SurfaceTiles'
import { BASE_ZOOM } from './tilePyramid'
import { createNorthUpScratch, NORTH_UP_RATE_PER_S, northUpStep } from './spinMath'
import type { SurfaceElevation } from './surfaceElevation'
import { simulatedElevation } from './surfaceView/simulatedElevation'
import { landDrop, type ScreenPoint } from './surfaceView/snapToRoute'
import { DropPicker, WalkerWidget, type GlobePicker, type GlobeProjector } from './surfaceView/WalkerDrop'

/**
 * The tilt group's starting orientation, the published axial tilt. One
 * array for every render, so a re-render never re-applies it over the
 * north-up ease.
 */
const START_TILT: [number, number, number] = [0, 0, MARS_AXIAL_TILT_DEG * DEG_TO_RAD]

/**
 * Loaded the first time someone stands on the surface, not with the
 * globe. Until it arrives the last orbit frame stays on screen under the
 * same notice SurfaceView shows while its ground loads.
 */
const SurfaceView = lazy(() =>
  import('./surfaceView/SurfaceView').then((m) => ({ default: m.SurfaceView })),
)

/** Read once per load: the probe is never toggled at runtime. */
const PERF = isPerfEnabled()

/** One empty list, so the default never changes identity between renders. */
const NO_GROUND_IMAGERY: readonly GroundImagery[] = []

/**
 * Mars globe v1: the sphere at published radius and tilt, the active
 * layer's NASA Mars Trek image, a slow demonstration spin that eases
 * north-up while it runs (spinMath.ts), and the
 * right-click pick that opens the context menu through the store. Camera
 * interaction lives in CameraController, which stops the spin on the
 * first interaction. The sun light, the grid and the route
 * overlay are mounted inside the mesh and live in their own files,
 * as are the detailed geologic units when the shell passes them,
 * shown while the geology layer is active.
 *
 * The surface image arrives through the store's `surfaceImage`, loaded by
 * the app shell through the layer adapter, so this feature never sees a
 * Trek URL. Its provenance is captioned by SurfaceCaption, which the shell
 * mounts in its own slot. Disposal: the texture is created here and disposed when the
 * image changes and on unmount. Geometry and material are declared as JSX,
 * which React Three Fiber disposes on unmount; the renderer is disposed
 * with the Canvas.
 *
 * Under `?perf` the performance probe mounts inside the Canvas and
 * may unmount and remount the scene's contents to check for leaks; the
 * surface texture stays, as it belongs to this component, not the scene.
 */
export function MarsGlobe({
  detail,
  groundImagery = NO_GROUND_IMAGERY,
  onDetailZoom,
  onGroundZoom,
  elevation,
  geology = null,
  traverse = null,
}: {
  detail: SurfaceDetail | null
  /** Finer brightness for the surface view's ground, coarsest first; empty to drape the layer alone. */
  groundImagery?: readonly GroundImagery[]
  /** The zoom of the detail tiles on screen, for the shell's caption. */
  onDetailZoom: (zoom: number | null) => void
  /** The zoom of the finer ground tiles on screen below the layer's own, for the caption; null when none. */
  onGroundZoom?: (zoom: number | null) => void
  /**
   * Ground heights for the surface view: the shell passes the elevation
   * adapter. Without one the view uses SIMULATED heights.
   */
  elevation?: SurfaceElevation
  /**
   * Detailed geologic units from the USGS adapter, drawn while the
   * geology layer is active; null for none.
   */
  geology?: readonly GeologicUnitArea[] | null
  /** A rover's driven path from the traverse adapter, or null for none. */
  traverse?: RoverTraverse | null
}) {
  const surface = useMissionStore((s) => s.surfaceImage)
  const geologyActive = useMissionStore((s) => s.activeLayerId === 'geology')
  const traverseSol = useTraverseSol(traverse)
  const [traverseHover, setTraverseHover] = useState<TraverseHover | null>(null)
  // The shown part of the path, for the surface view's overhead map.
  const traversePath = useMemo(
    () => traverse?.points.slice(0, traverseSol.count).map((p) => p.coordinate),
    [traverse, traverseSol.count],
  )
  const setCameraView = useMissionStore((s) => s.setCameraView)
  const texture = useSurfaceTexture(surface)
  // A thermal grid's colours, partly see-through over the base map's tiles.
  const drape = surface?.status === 'ready' ? surface.drape : undefined
  const mesh = useRef<Mesh>(null)
  // A ref, not state: the frame loop reads it, and stopping the spin
  // should not re-render the scene.
  const autoRotate = useRef(true)
  // Always true unless the probe is cycling the scene.
  const [sceneMounted, setSceneMounted] = useState(true)
  // The planet-wide mosaic among the ground imagery (CTX); the site mosaics cover only Jezero.
  const globalGround = globalGroundImagery(groundImagery)
  // Where the walker stands while the view mode is surface.
  const standing = useMissionStore((s) => (s.viewMode === 'surface' ? s.surfaceSpot : null))
  const enterSurface = useMissionStore((s) => s.enterSurface)
  const leaveSurface = useMissionStore((s) => s.leaveSurface)
  // Leaving the surface goes back to the route when it was entered from navigation.
  const surfaceReturn = useMissionStore((s) => s.surfaceReturn)
  const navigating = useMissionStore((s) => s.viewMode === 'navigation')
  // The line a drop snaps to: the followed route's DERIVED path, the same points the trail is drawn through.
  const routePath = useMissionStore((s) =>
    s.viewMode === 'navigation' && s.activeRoute?.path.classification === 'DERIVED' ? s.activeRoute.path.value : null,
  )
  const routeLine = useMemo(() => routePath?.map((p) => p.coordinate) ?? null, [routePath])
  const picker = useRef<GlobePicker | null>(null)
  const projector = useRef<GlobeProjector | null>(null)
  const dropWalker = (at: MarsCoordinate, screen: ScreenPoint): void => {
    const project = projector.current
    const landing = routeLine !== null && project !== null ? landDrop(at, screen, routeLine, project) : { at, note: null }
    enterSurface(landing.at, landing.note ?? undefined)
  }
  const surfaceNote = useMissionStore((s) => s.surfaceNote)
  // The site's name over the globe, moved by the scene each frame.
  const siteLabel = useRef<HTMLDivElement>(null)
  // The grid's degree numbers, moved the same way.
  const [gridLabels] = useState(() => new GridLabelBridge())
  const layerLabel = useMissionStore(
    (s) => s.layers.find((l) => l.id === s.activeLayerId)?.label ?? 'the active layer',
  )
  const routePicking = useRoutePick((s) => s.slot !== null)

  return (
    // The browser's own menu never shows over the scene; ours comes from the store.
    // A crosshair while a route field is being picked on the globe.
    <div
      className={`relative h-full w-full ${routePicking ? 'cursor-crosshair' : ''}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        camera={{
          position: [0, 0, GLOBE_RADIUS * START_CAMERA_DISTANCE_RADII],
          fov: CAMERA_FOV_DEG,
          // 100 km, as before the CTX mosaic; the camera controller lowers it with the altitude (nearForAltitude).
          near: 0.1,
          far: 100,
        }}
        gl={{ alpha: true, antialias: true }}
        dpr={[1, 2]}
        // The globe stops drawing while the surface view covers it.
        frameloop={standing ? 'never' : 'always'}
      >
        {sceneMounted && (
          <>
            <Starfield />
            <Globe meshRef={mesh} autoRotateRef={autoRotate} texture={texture}>
              {/* The base map's grey tiles go under a grid layer's colours only when they are see-through;
                 over an opaque grid, or a grid that failed, they would hide it. */}
              <SurfaceTiles detail={detail?.greyUnder && !drape ? null : detail} onZoomChange={onDetailZoom} />
              {/* Below the layer's finest tiles, the global CTX mosaic carries the ground's brightness,
                  as it does the surface view's: given only under the satellite layer (useGroundImagery), and
                  only below the old floor, so the views a user had before, Go to Jezero's included, keep
                  their colour. */}
              {globalGround && (
                <SurfaceTiles
                  detail={globalGround.detail}
                  tilePx={globalGround.tilePx}
                  finerThanZoom={detail?.maxZoom ?? BASE_ZOOM}
                  belowAltitudeKm={GROUND_BELOW_ALTITUDE_KM}
                  cap={GROUND_TILE_CAP}
                  lift={GROUND_LIFT}
                  onZoomChange={onGroundZoom}
                />
              )}
              {drape && <GridDrape image={drape.over} />}
              {geology && <GeologyOverlay areas={geology} visible={geologyActive} />}
              {traverse && (
                <RoverTraverseOverlay
                  traverse={traverse}
                  count={traverseSol.count}
                  onHover={setTraverseHover}
                />
              )}
            </Globe>
            {/* The settled view goes to the store; the altitude rule there
                moves welcome ↔ close-up, and the starfield and the shell's
                background react to the mode. */}
            <CameraController globe={mesh} autoRotate={autoRotate} onViewChange={setCameraView} />
            <HoverPick globe={mesh} />
            <DropPicker globe={mesh} pickerRef={picker} projectorRef={projector} />
            <SiteLabelTracker globe={mesh} labelRef={siteLabel} />
            <GridLabelTracker globe={mesh} bridge={gridLabels} />
          </>
        )}
        {PERF && <PerfProbe setSceneMounted={setSceneMounted} />}
      </Canvas>
      {/* Under the surface view while standing: the globe is covered then. */}
      {!standing && <GridLabels bridge={gridLabels} />}
      {!standing && <SiteLabel labelRef={siteLabel} />}
      {traverse && !standing && (
        <TraverseControls
          traverse={traverse}
          range={traverseSol.range}
          sol={traverseSol.sol}
          onSol={traverseSol.setSol}
          hover={traverseHover}
        />
      )}
      {standing ? (
        <Suspense
          fallback={
            <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-body text-ink">
              Loading the ground…
            </p>
          }
        >
          <SurfaceView
            start={standing}
            globeImage={surface?.status === 'ready' ? surface.image : null}
            // The base map's tiles under a grid layer are for the globe: on the ground they would cover the layer's colour.
            detail={detail?.greyUnder ? null : detail}
            groundImagery={groundImagery}
            elevation={elevation ?? simulatedElevation}
            layerLabel={layerLabel}
            geology={geologyActive ? geology : null}
            onExit={leaveSurface}
            exitLabel={surfaceReturn === 'navigation' ? 'Back to the route' : 'Back to orbit'}
            dropNote={surfaceNote}
            onTeleport={enterSurface}
            traverse={traversePath}
            traverseSource={traverse?.source}
          />
        </Suspense>
      ) : (
        <WalkerWidget
          pickerRef={picker}
          onDrop={dropWalker}
          hint={
            navigating
              ? 'Drag the walker onto the route to stand on its path: a drop near the line snaps to it. Esc or Back to the route returns here.'
              : undefined
          }
        />
      )}
    </div>
  )
}

/**
 * One GPU texture for the current image, made during render so no state
 * update is needed, and disposed when the image changes and on unmount.
 * The canvas belongs to the store and arrives final: the shell has drawn
 * the base map and the neutral colour under its no-data pixels, so
 * nothing is painted here and a discarded StrictMode render costs only an
 * un-uploaded Texture object.
 */
function useSurfaceTexture(surface: SurfaceImage | null): Texture | null {
  const texture = useMemo(() => {
    // A loading layer may come with the grey base to show meanwhile;
    // a grid layer's colours go over the tiles instead, its grey base under them.
    const image =
      surface?.status === 'ready'
        ? (surface.drape?.under ?? surface.image)
        : surface?.status === 'loading'
          ? surface.placeholder
          : undefined
    if (image === undefined) return null
    const next = new CanvasTexture(image)
    next.colorSpace = SRGBColorSpace
    return next
  }, [surface])
  useEffect(() => () => texture?.dispose(), [texture])
  return texture
}

interface GlobeProps {
  meshRef: RefObject<Mesh | null>
  /** The demo spin, and its north-up ease, run only while this is true. */
  autoRotateRef: RefObject<boolean>
  texture: Texture | null
  /** Mounted inside the mesh, so it spins and tilts with the surface. */
  children?: ReactNode
}

function Globe({ meshRef, autoRotateRef, texture, children }: GlobeProps) {
  const openContextMenu = useMissionStore((s) => s.openContextMenu)
  // While the Measure tool is active a left click sets its next point;
  // while a profile tool is, its next point or corner.
  const measuring = useMissionStore((s) => s.activeToolId === MEASURE_TOOL_ID)
  const picking = useMissionStore((s) => terrainPointLimit(s.activeToolId))
  const addMeasurePoint = useMeasure((s) => s.addMeasurePoint)
  const addTerrainPoint = useTerrainPoints((s) => s.addTerrainPoint)
  // While a route field is being picked a left click fills it
  // instead, and neither a tool's click nor the right-click menu fires.
  const routePicking = useRoutePick((s) => s.slot !== null)
  const pickRoutePoint = useRoutePick((s) => s.pickRoutePoint)
  // Whether the right-click menu or the Set point chooser was open when the
  // current press began. Each closes itself on that press (a window
  // capture listener added when it opens, so after this one), so by the
  // click it is already gone.
  const pressClosedMenu = useRef(false)
  useEffect(() => {
    const onPress = () => {
      pressClosedMenu.current = menuOpenAtPress(useMissionStore.getState())
    }
    window.addEventListener('pointerdown', onPress, true)
    return () => window.removeEventListener('pointerdown', onPress, true)
  }, [])
  const tilt = useRef<Group>(null)
  // The app opens turned to its site: the spin starts from the angle
  // that faces the site's longitude, set once when the site is known. Set
  // in an effect, not as a prop, so a re-render never puts it back over the
  // demo spin's progress.
  const siteLongitude = useSite((s) => s.site?.centre.longitudeEast ?? null)
  useEffect(() => {
    if (siteLongitude !== null && meshRef.current) meshRef.current.rotation.y = spinToFace(siteLongitude)
  }, [meshRef, siteLongitude])
  // Reused for every pick so the handler allocates nothing.
  const local = useRef(new Vector3())
  // Reused every frame by the north-up ease.
  const scratch = useRef(createNorthUpScratch())
  const screenUp = useRef(new Vector3())

  useFrame(({ camera }, delta) => {
    if (!meshRef.current || !tilt.current || !autoRotateRef.current) return
    // North eases to screen-up, so the spin turns about the screen's
    // vertical axis instead of diagonally. The tilt group has no
    // parent transform, so its quaternion is its world orientation.
    screenUp.current.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    northUpStep(
      tilt.current.quaternion,
      screenUp.current,
      easeStep(delta, NORTH_UP_RATE_PER_S),
      scratch.current,
    )
    meshRef.current.rotation.y += DEMO_SPIN_RAD_PER_S * delta
  })

  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!meshRef.current || routePicking) return
    const coordinate = pickCoordinate(e.ray, meshRef.current, local.current)
    if (coordinate) openContextMenu({ coordinate, anchor: { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } })
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const plain = isMeasureClick({
      deltaPx: e.delta,
      clickCount: e.nativeEvent.detail,
      closedMenu: pressClosedMenu.current,
    })
    if (!meshRef.current || !plain) return
    // A pin's menu opens only when the click is nobody else's: not during a route pick.
    if (!routePicking && !measuring && picking === null) {
      openPinMenu(e)
      return
    }
    e.stopPropagation()
    const coordinate = pickCoordinate(e.ray, meshRef.current, local.current)
    if (!coordinate) return
    // The route pick comes first: it was asked for last, over an open tool.
    if (routePicking) pickRoutePoint(coordinate)
    else if (picking !== null) addTerrainPoint(coordinate, picking)
    else addMeasurePoint(coordinate)
  }

  // A left click on a route pin or a marked point opens the right-click menu
  // on that point, where it can be removed, renamed or recoloured.
  // Pins are drawn in screen space (mapPin.ts), so the hit test is too.
  const openPinMenu = (e: ThreeEvent<MouseEvent>) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { routeDraft, markers } = useMissionStore.getState()
    const points = [...draftWaypoints(routeDraft).map((w) => w.coordinate), ...markers.map((m) => m.coordinate)]
    if (points.length === 0) return
    const rect = e.nativeEvent.target instanceof Element ? e.nativeEvent.target.getBoundingClientRect() : null
    if (!rect) return
    const v = local.current
    // Where the pins are drawn at this altitude.
    const radius = GLOBE_RADIUS * overlayLift(PIN_LIFT, e.camera.position.length() - GLOBE_RADIUS)
    const tips = points.map((c) => {
      mesh.localToWorld(coordinateToLocalPoint(c, radius, v))
      // Over the horizon the pin is not drawn (mapPin.ts), so it cannot be clicked.
      if (v.dot(e.camera.position) - v.lengthSq() <= 0) return null
      v.project(e.camera)
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
    })
    const hit = pinAtClick({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }, tips)
    if (hit < 0) return
    e.stopPropagation()
    openContextMenu({ coordinate: points[hit], anchor: { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } })
  }

  return (
    // Starts at the published tilt; the spin eases it north-up. The
    // tilt stays wherever the spin stopped: every reader of the globe's
    // orientation goes through matrixWorld, never the constant.
    <group ref={tilt} rotation={START_TILT}>
      <mesh ref={meshRef} onContextMenu={onContextMenu} onClick={onClick}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 64]} />
        {/* Lambert, the cheapest lit material: the sun light gives
            the day/night terminator; the layers' own shading stays in the
            texture. No specular, so no invented glossy surface. */}
        {/* Distinct keys: a fresh material (and shader program) when a
            texture arrives or goes, instead of mutating the untextured one.
            Swapping one layer's texture for another's reuses the program. */}
        {texture ? (
          <meshLambertMaterial key="textured" map={texture} />
        ) : (
          // Flat neutral surface while loading or unavailable: no invented features.
          <meshLambertMaterial key="untextured" color={NO_DATA_HEX} />
        )}
        {/* Inside the mesh, so the subsolar point stays on the surface. */}
        <SunLight />
        {children}
        <LandingColours />
        <CoordinateGrid />
        <LandingEllipse />
        <RouteOverlay />
        <MeasureLine />
        <TerrainRegion />
      </mesh>
    </group>
  )
}
