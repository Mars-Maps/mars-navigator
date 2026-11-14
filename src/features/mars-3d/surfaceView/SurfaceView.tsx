import { Canvas } from '@react-three/fiber'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { isAvailable, type DataClassification, type GeologicUnitArea, type MarsCoordinate } from '../../../domain'
import { describeSunElevation } from '../../../lib/horizon'
import { useEscapeLayer } from '../../../lib/useEscapeLayer'
import { useMissionStore, useMissionTimeStore, useSurfaceHeading, useWalkPlan } from '../../../state'
import { SkyDome, type SkyStatus } from '../sky/SkyDome'
import type { GroundImagery, SurfaceDetail } from '../surfaceDetail'
import type { SurfaceElevation } from '../surfaceElevation'
import { Ground } from './Ground'
import { GROUND_SPACING_M } from './groundPatch'
import { loadingLine, reliefNote, type GroundImageryStatus, type GroundStatus } from './groundStatus'
import type { MoveMode } from './moveMath'
import { OverheadMap } from './OverheadMap'
import type { MapPicture } from './overheadMapView'
import { PATCH_SIZE_KM } from './surfacePatch'
import { unitText, unitUnder } from '../geologyLabel'
import type { WalkPose } from './walkAlong'
import { REHEARSAL_SPEED_M_S, WalkDriver, type WalkStatus } from './WalkDriver'
import { WalkNotice } from './WalkNotice'
import { routeLine, routeLineDetail, routeLineText } from './routeLine'
import { walkProvenance, type WalkProvenance } from './walkProvenance'

/**
 * Surface view: stand anywhere on Mars at ground level, look around and
 * walk without limit. The 'surface' view mode: MarsGlobe
 * mounts it over the scene slot with its own Canvas and camera, and the
 * globe's Canvas stops rendering underneath. The shell's time menu and
 * icon panel stay on the right. The ground is
 * rebuilt around the walker as they go (Ground). Imagery is the active
 * layer's, sharpened with `groundImagery`'s brightness when the shell
 * offers it, the finest mosaic winning where several cover the
 * ground; heights come from `elevation` and are captioned with
 * whatever classification and source it reports; sky, sun and grain are
 * SIMULATED.
 *
 * The overhead map pans and zooms over the whole planet, small or
 * expanded, and a click on it teleports: `onTeleport` moves the spot, and Ground is rebuilt
 * around it, keyed on the spot, while the sky, mode and map stay.
 *
 * Disposal: Ground owns the patches and the grain texture; lights are JSX;
 * the renderer goes with the Canvas.
 */
export function SurfaceView({
  start,
  globeImage,
  detail,
  groundImagery,
  elevation,
  layerLabel,
  geology = null,
  onExit,
  exitLabel = 'Back to orbit',
  dropNote = null,
  onTeleport,
  traverse,
  traverseSource,
}: {
  start: MarsCoordinate
  globeImage: HTMLCanvasElement | null
  detail: SurfaceDetail | null
  /** Coarsest first; empty for none. */
  groundImagery: readonly GroundImagery[]
  elevation: SurfaceElevation
  layerLabel: string
  /** The geology areas on screen, or null while the layer is off. */
  geology?: readonly GeologicUnitArea[] | null
  onExit: () => void
  /** What leaving is called: "Back to orbit", or "Back to the route" when the surface was entered from navigation. */
  exitLabel?: string
  /** What happened to the drop: snapped onto the followed route, and how far; null when it landed where it was. */
  dropNote?: string | null
  /** Stand somewhere else without leaving the surface. */
  onTeleport: (at: MarsCoordinate) => void
  /** The rover's path up to the slider's sol, for the overhead map and the ground. */
  traverse?: readonly MarsCoordinate[]
  traverseSource?: string
}) {
  const [status, setStatus] = useState<GroundStatus>({ kind: 'loading' })
  const [sky, setSky] = useState<SkyStatus | null>(null)
  const [near, setNear] = useState<GroundImageryStatus | null>(null)
  const utcMs = useMissionTimeStore((s) => s.utcMs)
  const readout = useRef<HTMLSpanElement>(null)
  const picture = useRef<MapPicture | null>(null)
  const observer = useRef<MarsCoordinate | null>(null)
  const yaw = useRef(0)
  // The walk along the plan: the driver writes the pose, the ground applies it.
  const walkPose = useRef<WalkPose | null>(null)
  const [walk, setWalk] = useState<WalkStatus>(null)
  const legs = useWalkPlan((s) => s.plan?.legs ?? null)
  const line = useMemo(() => (legs ? walkProvenance(legs) : null), [legs])
  // The route being followed, when the surface was entered from navigation.
  const route = useMissionStore((s) => s.activeRoute)
  const routeOnGround = useMemo(() => routeLine(route), [route])
  const labelLayer = useRef<HTMLDivElement>(null)
  const [mapExpanded, setMapExpanded] = useState(false)
  // The app's one Escape stack: standing on the surface is a
  // layer from entry to exit, so anything opened later closes first. Here,
  // not in the ground, which a teleport remounts and would move to the top.
  // Within the layer: the map's menu and the expanded map first, then leave.
  const mapEscape = useRef<(() => boolean) | null>(null)
  useEscapeLayer(true, () => {
    if (!mapEscape.current?.()) onExit()
  })
  // A teleport builds new ground: say so until it is ready.
  const [groundAt, setGroundAt] = useState(start)
  if (groundAt !== start) {
    setGroundAt(start)
    setStatus({ kind: 'loading' })
    setNear(null)
  }
  // Walk or fly; the button and the F key flip it.
  const [mode, setMode] = useState<MoveMode>('walk')
  const toggleModeRef = useRef(() => setMode((m) => (m === 'walk' ? 'fly' : 'walk')))

  // With neither the globe image nor detail tiles the ground is a plain
  // fill, not imagery.
  const hasImagery = globeImage !== null || detail !== null
  // The ground mosaics over the current patch, once it has one, and those that drew.
  const ground = status.kind === 'ready' ? status.ground : []
  const drawn = ground.filter((g) => g.loaded !== 0)
  const loading = loadingLine(status)

  return (
    // The browser's own menu never shows over the ground; ours opens from it.
    <div className="absolute inset-0 bg-canvas" onContextMenu={(e) => e.preventDefault()}>
      <Canvas
        camera={{ fov: 70, near: 0.5, far: 40000 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
        style={{ cursor: 'grab' }}
      >
        {/* Sky, light and fog; the fog fades out before the patch edge, never nearer than 14 km. */}
        <SkyDome observerRef={observer} labelLayerRef={labelLayer} onStatus={setSky} />
        <Ground
          // A new spot is new ground with its own frame, not a walk from the old one.
          key={`${start.latitude},${start.longitudeEast}`}
          start={start}
          sources={{ elevation, detail, groundImagery, globeImage }}
          onStatus={setStatus}
          onNearStatus={setNear}
          mode={mode}
          onToggleModeRef={toggleModeRef}
          readoutRef={readout}
          pictureRef={picture}
          observerRef={observer}
          yawRef={yaw}
          walkPoseRef={walkPose}
          traverse={traverse}
        />
        <WalkDriver start={start} observerRef={observer} poseRef={walkPose} onStatus={setWalk} />
      </Canvas>
      <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden" />
      <WalkNotice walk={walk} line={line} speedMS={REHEARSAL_SPEED_M_S} />

      {/* The heights, then the pictures on them and on the map. */}
      {loading && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-body text-ink">{loading}</p>
      )}

      {/* The left column: the panel at the top, scrolling if it must, and the overhead map below it.
          The panel takes at most 45% of the column and the map window the rest, its caption scrolling inside:
          a caption that changes height (the pointer line, the legend) no longer resizes the panel.
          The expanded map's minimum height makes the panel give way (shrink-[100]), down to its title row. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-start justify-between gap-3 p-4">
        <section className="pointer-events-auto flex max-h-[45%] min-h-16 w-96 max-w-full shrink-[100] flex-col gap-2 overflow-y-auto rounded-panel border border-line/60 bg-surface/80 p-4 text-caption text-ink-muted shadow-panel backdrop-blur-glass">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-heading text-ink">Surface view</h2>
            <div className="flex gap-2">
              <button
                type="button"
                title="F key"
                // An action, not a toggle state: the label says what happens next, so no aria-pressed.
                // Focus leaves the button, since Space is now a movement key.
                onClick={(e) => {
                  e.currentTarget.blur()
                  toggleModeRef.current()
                }}
                className="rounded-control border border-line px-2 py-1 text-body text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
              >
                {mode === 'fly' ? 'Land' : 'Fly'}
              </button>
              <button
                type="button"
                onClick={onExit}
                className="rounded-control border border-line px-2 py-1 text-body text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised"
              >
                {exitLabel}
              </button>
            </div>
          </div>
          <Row badge="DERIVED">
            <span ref={readout} className="font-mono text-ink">
              —
            </span>
            <br />
            Your position, from the drop point and how far you have walked or flown.
          </Row>
          {dropNote && (
            <Row badge="DERIVED">
              <span data-drop-note="">{dropNote}</span>: the drop landed near the route’s line and was moved onto it, so you
              stand on the path.
            </Row>
          )}
          {/* Near the top, not in the long rows below: what the eye gets wrong first. */}
          {status.kind === 'ready' && (
            <Row badge="DERIVED">
              <span className="text-ink">{reliefNote(GROUND_SPACING_M)}</span>
            </Row>
          )}
          {status.kind === 'unavailable' ? (
            <Row badge="UNAVAILABLE">
              No ground heights here: {status.reason}. The ground is not drawn rather than drawn
              flat.
            </Row>
          ) : (
            status.kind === 'ready' && (
              <Row badge={status.provenance.classification}>Heights: {status.provenance.text}</Row>
            )
          )}
          {status.kind === 'ready' && status.edge && (
            <p className="text-simulated">Cannot load the ground ahead: {status.edge}. Waiting at the edge.</p>
          )}
          {hasImagery ? (
            <Row badge="OFFICIAL">
              Imagery: {layerLabel}, stretched over the ground.
              {drawn.length > 0
                ? drawn.map(({ imagery: i }) => ` Brightness from the ${i.label}, credit ${i.credit}. ${i.caveat}.`).join('')
                : ' Blurry up close: its pixels are tens to hundreds of metres across.'}{' '}
              A layer switch shows from the next patch of ground.
            </Row>
          ) : (
            <Row badge="UNAVAILABLE">
              Imagery: {layerLabel} has not loaded, so the ground is a plain fill.
            </Row>
          )}
          {geology !== null && <GeologyRow areas={geology} at={start} />}
          <GroundImageryRows ground={ground} />
          {line && <PlannedWalkRow line={line} />}
          {routeOnGround && (
            <Row badge={routeOnGround.classification} detail={routeLineDetail(routeOnGround)}>
              <span data-route-line="">{routeLineText(routeOnGround)}</span>
            </Row>
          )}
          {traverse && traverse.length > 1 && traverseSource && (
            <Row badge="DERIVED" detail={`Waypoints: ${traverseSource}. Heights: this view's elevation model, not the rover's.`}>
              The rover's path: the solid fuchsia line on the ground, its published waypoints joined
              straight and draped on this view's heights.
            </Row>
          )}
          {near && <NearFieldRow near={near} />}
          {sky && sky.derived.length > 0 && (
            <Row badge="DERIVED">
              Sky at {new Date(utcMs).toISOString().slice(0, 16).replace('T', ' ')} UTC (the time
              menu): {sky.derived.join(', ')} where they really are, each at its true size. From JPL
              planet elements, a fit to JPL Horizons for the moons, and the IAU Mars rotation model;
              within about 0.1° of Horizons near the equator, up to 0.35° at high latitudes, as
              "up" here is from a sphere and Horizons uses the ellipsoid.
              {sky.sunAltitudeDeg !== null && <> Sun {describeSunElevation(sky.sunAltitudeDeg)}.</>}
            </Row>
          )}
          {sky?.unavailable.map((u) => (
            <Row key={u.label} badge="UNAVAILABLE">
              {u.label}: {u.reason}.
            </Row>
          ))}
          <Row badge="UNAVAILABLE">Stars: no star catalogue is connected yet.</Row>
          <Row badge="SIMULATED">
            For looks only: the rocks and pebbles, the ground's fine texture and its dust and
            dark-sand patches (laid over the real imagery, which still sets the colour from afar),
            sky colours, the light's strength and body colours.
            {sky?.sunAltitudeDeg === null && ' The Sun is placed at a fixed angle.'}
          </Row>
          <p>
            The ground is drawn flat in {PATCH_SIZE_KM} km squares that follow you, so Mars's
            curvature is ignored. Walking speed is sped up.
          </p>
          <p className="text-ink-subtle">
            {mode === 'fly'
              ? 'Drag to look · W A S D or arrows to fly where you look · Space and C up and down · Shift for speed · wheel to climb or descend · Z to zoom like binoculars · L for labels · F to land · Esc to leave'
              : 'Drag to look · W A S D or arrows to walk · Shift to run · wheel to rise or land · Z to zoom like binoculars · L for labels · F to fly · Esc to leave'}
          </p>
        </section>
        <OverheadMap
          expanded={mapExpanded}
          globeImage={globeImage}
          detail={detail}
          walkerRef={observer}
          spot={start}
          yawRef={yaw}
          pictureRef={picture}
          layerLabel={layerLabel}
          hasImagery={hasImagery}
          escapeRef={mapEscape}
          onTeleport={onTeleport}
          onExpand={() => setMapExpanded(true)}
          onCollapse={() => setMapExpanded(false)}
          traverse={traverse}
          traverseSource={traverseSource}
        />
      </div>
    </div>
  )
}

/**
 * How the ground imagery was put on the ground: the pan-sharpening
 * is DERIVED and says its method once, then each mosaic that drew, by name,
 * with its zoom and any tiles still loading or missing. A mosaic
 * none of whose tiles loaded gets its own UNAVAILABLE row, since the OFFICIAL
 * row above no longer names it.
 */
function GroundImageryRows({ ground }: { ground: GroundImageryStatus[] }) {
  const drawn = ground.filter((g) => g.loaded !== 0)
  return (
    <>
      {ground
        .filter((g) => g.loaded === 0)
        .map(({ imagery, total }) => (
          <Row key={imagery.detail.layerId} badge="UNAVAILABLE">
            {imagery.label}: none of its {total} tiles could be loaded, so what lies under it shows there.
          </Row>
        ))}
      {drawn.length > 0 && (
        <Row badge="DERIVED">
          Pan-sharpened: the layer's colour with the mosaics' brightness, blended on a canvas in
          luminosity mode, so the colour is the layer's and every edge and shadow is a mosaic's;
          where they overlap the finest wins.
          {drawn.map(({ imagery, zoom, total, loaded }) => {
            const resolution = imagery.detail.resolutionAt(zoom)
            const missing = loaded === null ? 0 : total - loaded
            return (
              <span key={imagery.detail.layerId}>
                {' '}
                {imagery.label}: zoom {zoom}
                {resolution.classification !== 'UNAVAILABLE' && `, ${resolution.value}`}
                {loaded === null && ', still loading'}
                {missing > 0 && `, ${missing} of ${total} tiles did not load`}.
              </span>
            )
          })}
        </Row>
      )}
    </>
  )
}

/**
 * The planned line on the ground, classified and credited from the
 * legs themselves: an invented sample line says so, never "the route
 * planner".
 */
function PlannedWalkRow({ line }: { line: WalkProvenance }) {
  const skipped =
    line.unrouted > 0
      ? ` ${line.unrouted === 1 ? 'One leg has' : `${line.unrouted} legs have`} no path, so ${line.unrouted === 1 ? 'is' : 'are'} not drawn.`
      : ''
  return line.classification === 'UNAVAILABLE' ? (
    <Row badge="UNAVAILABLE" detail={line.from}>
      Planned walk: no leg has a path, so no line is drawn ({line.from}).
    </Row>
  ) : (
    <Row badge={line.classification} detail={line.from}>
      Planned walk: the dashed white line on the ground,{' '}
      {line.classification === 'SIMULATED' ? `invented, not a route: ${line.from}.` : `from ${line.from}.`}
      {skipped}
    </Row>
  )
}

/**
 * The near-field image: OFFICIAL imagery blended in the shader by the
 * same method as the ground picture, so DERIVED as that row is, named with
 * its credit and how many tiles drew.
 */
function NearFieldRow({ near }: { near: GroundImageryStatus }) {
  const { imagery, zoom, total, loaded } = near
  const resolution = imagery.detail.resolutionAt(zoom)
  if (loaded === 0) {
    return (
      <Row badge="UNAVAILABLE">
        Up close: none of the {total} tiles of the {imagery.label} around you could be loaded.
      </Row>
    )
  }
  return (
    <Row badge="DERIVED">
      Up close, within about 300 m of you: brightness from the {imagery.label}, zoom {zoom}
      {resolution.classification !== 'UNAVAILABLE' && `, ${resolution.value}`}, credit {imagery.credit}.{' '}
      {imagery.caveat}. Only its detail finer than the ground picture's 20 m pixels is
      added to the brightness, by the same luminosity blend, so the tones at 20 m stay the ground
      picture's. It fades out at its edge and with distance, beyond about 100 m on foot, where the
      screen can no longer show it; where it shows, the simulated metre-scale texture is left off.
      {loaded === null ? ' Still loading.' : loaded < total && ` ${total - loaded} of ${total} tiles did not load.`}
    </Row>
  )
}

function Row({
  badge,
  detail,
  children,
}: {
  badge: DataClassification
  /** The method, source or reason, in the mark's tooltip. */
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 pt-0.5">
        <ClassificationBadge classification={badge} detail={detail} />
      </span>
      <p>{children}</p>
    </div>
  )
}

/**
 * The geologic unit at the spot the walker stood down on, from the
 * same lookup as the globe's hover readout. Where no loaded map covers the
 * spot it says so, never a nearest unit.
 */
function GeologyRow({ areas, at }: { areas: readonly GeologicUnitArea[]; at: MarsCoordinate }) {
  // The walker's place, about four times a second while moving, so only this row re-renders.
  const position = useSurfaceHeading((s) => s.position)
  const unit = unitUnder(areas, position && isAvailable(position) ? position.value : at)
  return unit.classification === 'UNAVAILABLE' ? (
    <Row badge="UNAVAILABLE">Geologic unit: {unit.reason}.</Row>
  ) : (
    <Row badge={unit.classification}>
      Geologic unit where you stand: {unitText(unit.value)}, from USGS {unit.value.map.id}.
    </Row>
  )
}
