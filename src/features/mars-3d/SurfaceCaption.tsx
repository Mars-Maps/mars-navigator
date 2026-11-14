import { useCallback, useRef, useState, type Ref } from 'react'
import { ClassificationBadge } from '../../components/ClassificationBadge'
import type { Classified, GeologicUnitArea, MapLayer, MarsSolarTime, RoverTraverse } from '../../domain'
import { useMissionStore, useMissionTime, type SurfaceImage } from '../../state'
import { captionAlerts, minimizesForNavigation, opensCaption } from './captionAlerts'
import { colourNote, geologyMaps } from './geologyLabel'
import { GeologyUnitReadout } from './GeologyUnitReadout'
import { hasRouteLine } from './routeWaypoints'
import { traverseCaption } from './traverseLabel'
import type { GroundImagery, SurfaceDetail } from './surfaceDetail'

/**
 * Provenance for what is on the globe, classified. Everything said
 * about the layer comes from its `MapLayer` and the adapter's resolutions;
 * nothing is written here. The shell mounts it in its own slot, at the
 * bottom of the left column clear of the tool dock, on the glass surface so it reads
 * on the terrain, and keeps it on screen under "Hide all tools" with the
 * scene, so the SIMULATED spin is never unlabelled.
 *
 * It minimizes to an info button and nothing else:
 * the shell's corner label keeps the simulated data
 * labelled while the caption is closed. It starts minimized and opens
 * itself when a new error or caveat appears (captionAlerts). Each
 * classification is a small mark whose tooltip adds the method or source.
 */
export function SurfaceCaption({
  detail,
  detailZoom,
  ground = null,
  geology = null,
  traverse = null,
}: {
  detail: SurfaceDetail | null
  /** Zoom of the detail tiles on screen, from MarsGlobe; null when none. */
  detailZoom: number | null
  /** The finer ground drawn below the layer's own tiles and the zoom on screen; null when none. */
  ground?: { imagery: GroundImagery; zoom: number } | null
  /**
   * Detailed geologic units as the adapter answered, UNAVAILABLE
   * with the reason while loading or on failure; captioned while the
   * geology layer is active.
   */
  geology?: Classified<GeologicUnitArea[]> | null
  /**
   * The rover path drawn on the globe as the adapter answered,
   * UNAVAILABLE with the reason while loading or on failure; null for none.
   */
  traverse?: Classified<RoverTraverse> | null
}) {
  const geologyActive = useMissionStore((s) => s.activeLayerId === 'geology')
  const surface = useMissionStore((s) => s.surfaceImage)
  const layers = useMissionStore((s) => s.layers)
  const activeLayerId = useMissionStore((s) => s.activeLayerId)
  const routeLine = useMissionStore((s) => hasRouteLine(s.routeDraft))
  const navigating = useMissionStore((s) => s.viewMode === 'navigation')
  const sunShading = useMissionStore((s) => s.sunShading)
  // While navigating a route with a DERIVED path, the line is that path and
  // the caption states its method instead of the "not a planned path" note.
  // A string, not an object, so the selector is stable. A planner
  // only ever derives a path; an OFFICIAL or SIMULATED one would be a
  // dataset's route, which this caption does not describe.
  const drawnPath = useMissionStore((s) => {
    const path = s.activeRoute?.path
    return path?.classification === 'DERIVED' ? path.method : null
  })
  const { solar } = useMissionTime()
  const alerts = captionAlerts({ surface, layers, activeLayerId, routeLine, sun: solar, traverse, geology: geologyActive ? geology : null })
  const alertKey = alerts.join('|')
  const [seen, setSeen] = useState<{ key: string; alerts: string[] } | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [wasNavigating, setWasNavigating] = useState(navigating)
  // Adjusted while rendering rather than in an effect, so a failure never
  // paints minimized first. Only a failure opens it.
  if (alertKey !== seen?.key) {
    setSeen({ key: alertKey, alerts })
    if (opensCaption(seen?.alerts ?? [], alerts)) setCollapsed(false)
  }
  // Entering navigation minimizes it unless an error is showing;
  // the user can open it again. Runs after the alert check, so a new note
  // arriving in the same render would be minimized unseen; planning a route
  // changes no layer, so none does today.
  if (navigating !== wasNavigating) {
    setWasNavigating(navigating)
    if (navigating && minimizesForNavigation(alerts)) setCollapsed(true)
  }
  // Minimize and expand are different buttons, so the swapped-out one
  // unmounts and focus would fall to <body>. When it had focus, or was just
  // pressed, its replacement takes it; an alert opening the caption never
  // takes focus from anywhere else.
  const toggled = useRef(false)
  const mounted = useRef<HTMLButtonElement | null>(null)
  const toggleRef = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) {
      if (mounted.current !== null && mounted.current === document.activeElement) {
        toggled.current = true
      }
    } else if (toggled.current) {
      toggled.current = false
      button.focus()
    }
    mounted.current = button
  }, [])
  return (
    <SurfaceCaptionView
      surface={surface}
      layers={layers}
      routeLine={routeLine}
      drawnPath={drawnPath}
      detail={detail && detailZoom !== null ? detail.resolutionAt(detailZoom) : null}
      ground={
        ground
          ? {
              label: ground.imagery.label,
              credit: ground.imagery.credit,
              caveat: ground.imagery.caveat,
              resolution: ground.imagery.detail.resolutionAt(ground.zoom),
            }
          : null
      }
      sun={solar}
      sunShading={sunShading}
      geology={geologyActive ? geology : null}
      traverse={traverse}
      collapsed={collapsed}
      onToggle={() => {
        toggled.current = true
        setCollapsed((c) => !c)
      }}
      toggleRef={toggleRef}
    />
  )
}

const TOGGLE_CLASS =
  'shrink-0 rounded-control text-ink-subtle transition-colors duration-(--duration-fast) hover:text-ink focus-visible:text-ink'

/** The information mark: a circled "i". */
function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

/** The caption from its inputs, so it can be rendered in a test for every surface state. */
export function SurfaceCaptionView({
  surface,
  layers,
  routeLine,
  drawnPath = null,
  detail,
  ground = null,
  sun,
  sunShading,
  geology = null,
  traverse = null,
  collapsed = false,
  onToggle,
  toggleRef,
}: {
  surface: SurfaceImage | null
  layers: readonly MapLayer[]
  /** Whether a route line is drawn, so the caption says what it is. */
  routeLine: boolean
  /**
   * The method of the navigated route's DERIVED path when the line is a
   * planned route; null while it only joins the user's picks.
   */
  drawnPath?: string | null
  /** Resolution of the detail tiles on screen, or null when there are none. */
  detail: Classified<string> | null
  /** The finer ground below the layer's own tiles, or null when none is drawn. */
  ground?: GroundLine | null
  /** The sun position lighting the globe, or why there is none. */
  sun: Classified<MarsSolarTime>
  /** Whether the globe shows it as day and night, or the right-click menu turned that off. */
  sunShading: boolean
  /** The detailed geologic units, or null while the layer is off. */
  geology?: Classified<GeologicUnitArea[]> | null
  /** The rover path drawn on the globe, or why there is none; null for none asked. */
  traverse?: Classified<RoverTraverse> | null
  /** Minimized to the info button and the SIMULATED badge. */
  collapsed?: boolean
  onToggle?: () => void
  /** On both toggle buttons, so focus can follow a press. */
  toggleRef?: Ref<HTMLButtonElement>
}) {
  const layer = layers.find((l) => l.id === surface?.layerId)
  const base = layers.find(
    (l) =>
      surface?.status === 'ready' && surface.base.status === 'drawn' && l.id === surface.base.layerId,
  )
  if (collapsed) {
    return (
      <aside
        aria-label="Surface provenance"
        className="flex items-center gap-2 self-start rounded-control border border-line/60 bg-surface/80 px-2 py-1 text-caption text-ink-muted backdrop-blur-glass"
      >
        <button
          type="button"
          aria-expanded={false}
          aria-label="Show surface provenance"
          title="Show surface provenance"
          onClick={onToggle}
          ref={toggleRef}
          className={TOGGLE_CLASS}
        >
          <InfoIcon />
        </button>
      </aside>
    )
  }
  return (
    <aside
      aria-label="Surface provenance"
      className="flex items-start gap-2 rounded-control border border-line/60 bg-surface/80 px-2 py-1 text-caption text-ink-muted backdrop-blur-glass"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <SurfaceLines surface={surface} layer={layer} base={base} detail={detail} ground={ground} />
        {/* The terminator comes from the sun model (SunLight); the
            method is the one the time menu shows. Neutral light is never
            passed off as a sun position. */}
        {sun.classification === 'UNAVAILABLE' ? (
          <p className="flex items-center gap-1.5">
            Sun position unavailable: {sun.reason}; lit evenly, no day or night
            <ClassificationBadge classification="UNAVAILABLE" />
          </p>
        ) : !sunShading ? (
          <p>Sun shading hidden: lit evenly. Right-click to show day and night</p>
        ) : (
          <p className="flex items-center gap-1.5">
            Day and night from the Mars24 sun position at the mission time; right-click to
            hide the shading
            <ClassificationBadge
              classification={sun.classification}
              detail={sun.classification === 'DERIVED' ? sun.method : sun.source}
            />
          </p>
        )}
        {geology?.classification === 'UNAVAILABLE' && (
          <p className="flex items-center gap-1.5">
            Detailed geologic units not shown: {geology.reason}
            <ClassificationBadge classification="UNAVAILABLE" />
          </p>
        )}
        {geology?.classification === 'OFFICIAL' && (
          <>
            {geologyMaps(geology.value).map((map) => (
              <p key={map.id} className="flex items-center gap-1.5">
                Geologic units from {map.text}; {colourNote(geology.value)}
                <ClassificationBadge classification="OFFICIAL" detail={geology.source} />
              </p>
            ))}
            <GeologyUnitReadout areas={geology.value} source={geology.source} />
          </>
        )}
        {traverse?.classification === 'OFFICIAL' && (
          <p className="flex items-center gap-1.5">
            {traverseCaption(traverse.value)}
            <ClassificationBadge classification="OFFICIAL" detail={traverse.source} />
          </p>
        )}
        {traverse?.classification === 'UNAVAILABLE' && (
          <p className="flex items-center gap-1.5">
            Rover's driven path not shown: {traverse.reason}
            <ClassificationBadge classification="UNAVAILABLE" />
          </p>
        )}
        <p className="flex items-center gap-1.5">
          The globe turns faster than Mars does
          <ClassificationBadge classification="SIMULATED" />
        </p>
        {/* The dotted trail is a drawing of the user's picks until a
            route with a method is navigated; then it is that route. */}
        {routeLine && drawnPath !== null ? (
          <p className="flex items-center gap-1.5">
            Route line is the selected route's path
            <ClassificationBadge classification="DERIVED" detail={drawnPath} />
          </p>
        ) : (
          routeLine && <p>Route line joins your waypoints in order; not a planned path</p>
        )}
      </div>
      <button
        type="button"
        aria-expanded={true}
        aria-label="Minimize surface provenance"
        title="Minimize"
        onClick={onToggle}
        ref={toggleRef}
        className={`${TOGGLE_CLASS} px-1 leading-none`}
      >
        –
      </button>
    </aside>
  )
}

/** What the caption says of the finer ground: the source's own words, and the resolution shown. */
export interface GroundLine {
  label: string
  credit: string
  caveat: string
  resolution: Classified<string>
}

function SurfaceLines({
  surface,
  layer,
  base,
  detail,
  ground = null,
}: {
  surface: SurfaceImage | null
  layer: MapLayer | undefined
  base: MapLayer | undefined
  detail: Classified<string> | null
  ground?: GroundLine | null
}) {
  const name = layer?.label ?? surface?.layerId ?? 'surface layer'
  if (surface === null || surface.status === 'loading') return <p>Loading {name}…</p>
  if (surface.status === 'unavailable') {
    return (
      <p className="flex items-center gap-1.5">
        {name} unavailable: {surface.reason}
        <ClassificationBadge classification="UNAVAILABLE" />
      </p>
    )
  }
  if (!layer) return null
  return (
    <>
      <p className="flex items-center gap-1.5">
        {layer.label}
        {layer.caveat !== null && ` — ${layer.caveat}`}
        <ClassificationBadge classification={layer.classification} detail={layer.source} />
      </p>
      <p>
        {layer.provider} · {layer.licence} · source {resolutionText(surface.sourceResolution)}, shown{' '}
        {resolutionText(surface.servedResolution)}
      </p>
      {surface.base.status === 'drawn' && !surface.drape && (
        <p>Grey {base?.label ?? surface.base.layerId} where this layer has no data</p>
      )}
      {/* A grid layer laid partly see-through over the base. */}
      {surface.base.status === 'drawn' && surface.drape && (
        <p>
          Grey {base?.label ?? surface.base.layerId} under this layer, seen through its colours, and alone where it
          has no data. The colours are mixed 60/40 with that grey, so a cell's shade can read up to about two legend
          steps lighter or darker than its value: compare neighbours, and read a value in the point menu
        </p>
      )}
      {surface.base.status === 'unavailable' && (
        <p className="flex items-center gap-1.5">
          No-data areas unfilled: {surface.base.reason}
          <ClassificationBadge classification="UNAVAILABLE" />
        </p>
      )}
      {detail !== null && !surface.drape && <p>Detail tiles {resolutionText(detail)} where loaded</p>}
      {/* The tiles then are the base map's, not this layer's. */}
      {detail !== null && surface.drape && (
        <p>
          Grey {base?.label ?? 'base map'} detail tiles {resolutionText(detail)} under it where loaded
        </p>
      )}
      {ground !== null && (
        <p className="flex items-center gap-1.5">
          Closer than this layer's finest tiles: {ground.label}, {resolutionText(ground.resolution)} where loaded,
          credit {ground.credit}. {ground.caveat}.
          <ClassificationBadge classification="OFFICIAL" detail={ground.label} />
        </p>
      )}
    </>
  )
}

/** A resolution line, or the reason there is none. Never a made-up figure. */
function resolutionText(r: Classified<string>): string {
  return r.classification === 'UNAVAILABLE' ? `unavailable (${r.reason})` : r.value
}
