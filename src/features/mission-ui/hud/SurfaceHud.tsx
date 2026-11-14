import { useMemo, type ReactNode } from 'react'
import {
  isAvailable,
  SUITED_SLOPE_LIMIT,
  type Classified,
  type Hazard,
  type MarsCoordinate,
  type MarsSolarTime,
  type SlopeLimit,
} from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { useMissionTime, useSurfaceHeading, useWalkPlan } from '../../../state'
import { ClassifiedValue } from '../ClassifiedValue'
import { RadiationHudGlyph } from '../radiation/RadiationWarning'
import { SlopeLimitFlag } from '../SlopeLimitFlag'
import { formatSlope, legSlopeToFlag, shownSlope } from '../slopeLimit'
import { formatHours } from '../time/timeControls'
import {
  describeSunElevation,
  formatBearing,
  hudStops,
  hudWayPoints,
  localSolarTime,
  shownSunElevation,
  type HudStop,
} from './hudMath'
import {
  aimedPoint,
  ARRIVAL_KM,
  directionText,
  formatWayDistance,
  isReached,
  pointerAngle,
  shownDistance,
  type WayPoint,
} from './wayPointerMath'

/**
 * The HUD on the shared walk plan: the plan's stops,
 * its slope limit and the stop being walked to from `useWalkPlan`, the
 * walker's heading from `useSurfaceHeading`, Mars time from the mission
 * clock. Nothing while nobody stands on the surface (no heading yet). The
 * shell passes where the walker stands and the sky's sun elevation.
 */
export function PlannedSurfaceHud({
  position,
  sunElevationDeg,
}: {
  position: Classified<MarsCoordinate>
  sunElevationDeg: Classified<number>
}) {
  const plan = useWalkPlan((s) => s.plan)
  const activeStopIndex = useWalkPlan((s) => s.activeStopIndex)
  const goToStop = useWalkPlan((s) => s.goToStop)
  const heading = useSurfaceHeading((s) => s.heading)
  const { solar } = useMissionTime()
  const stops = useMemo(() => (plan ? hudStops(plan) : []), [plan])
  if (!heading) return null
  return (
    <SurfaceHud
      heading={heading}
      position={position}
      stops={stops}
      slopeLimit={plan?.slopeLimit ?? SUITED_SLOPE_LIMIT}
      activeStopIndex={activeStopIndex}
      onGoToStop={goToStop}
      sunElevationDeg={sunElevationDeg}
      solar={solar}
    />
  )
}

/**
 * The HUD in the surface view: a helmet-style display that guides
 * the walker along the planned walk, stop to stop. Built on the way
 * pointer: an arrow turned from straight ahead to the next stop, its name,
 * distance and bearing, with one radiation glyph when the leg ahead carries
 * the hazard; then the steepest slope of that leg, flagged over the
 * plan's limit; then the sun and the local solar time.
 *
 * The stop it aims at is the shared plan's (`activeStopIndex`).
 * Within reach of it the HUD says it is reached and waits: only the
 * buttons pick another, through `onGoToStop`, since the surface walk
 * sets off whenever the index changes and every other view follows it.
 *
 * It is on whenever the walker stands on the surface with a plan, with no
 * Escape layer of its own: Esc stays the surface's, which closes the
 * expanded map first, then leaves. It can be minimised to
 * its title bar, which keeps the stop count and Previous / Next, so
 * the walk goes on while it is small and the view behind it is free. Props
 * only (`PlannedSurfaceHud` wires it), so the host decides where it sits.
 */
export function SurfaceHud({
  heading,
  position,
  stops,
  slopeLimit,
  activeStopIndex,
  onGoToStop,
  sunElevationDeg,
  solar,
  defaultMinimized = false,
}: {
  /** The walker's compass heading, as `useSurfaceHeading` holds it. */
  heading: Classified<number>
  /** Where the walker stands. */
  position: Classified<MarsCoordinate>
  /** The planned walk's stops in walking order (`hudStops`). Empty while nothing is planned. */
  stops: readonly HudStop[]
  slopeLimit: SlopeLimit
  /** The stop being walked to: `useWalkPlan`'s `activeStopIndex`. */
  activeStopIndex: number
  /** Aims at another stop: `useWalkPlan`'s `goToStop`. */
  onGoToStop: (index: number) => void
  /** The sky's own figure for where the walker stands, so the HUD and the surface caption agree. */
  sunElevationDeg: Classified<number>
  /** The mission clock's Mars time, `useMissionTime().solar`. */
  solar: Classified<MarsSolarTime>
  /** Starts minimised: for a test of the bar. The app opens it expanded. */
  defaultMinimized?: boolean
}) {
  const { minimized, toggle, bodyId } = useMinimized(defaultMinimized)
  const points = hudWayPoints(position, stops)
  // Never written back on arrival: the walk driver walks on every
  // change of the index, so one Next would otherwise run through every stop.
  const aimed = aimedPoint(points, activeStopIndex)
  const back = aimed > 0 ? aimed - 1 : null

  return (
    <Panel surface="glass" compact className="flex w-96 max-w-full flex-col gap-3">
      {/* The title bar keeps the count and Previous / Next while minimised. */}
      <PanelHeader title="Walk guide" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId}>
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-body text-ink">Walk guide</h2>
          {points.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-caption tabular-nums text-ink-subtle">{`${aimed + 1} of ${points.length}`}</span>
              <StepButton label="Previous stop" disabled={back === null} onClick={() => onGoToStop(back ?? aimed)}>
                <path d="M15 6l-6 6 6 6" />
              </StepButton>
              <StepButton label="Next stop" disabled={aimed === points.length - 1} onClick={() => onGoToStop(aimed + 1)}>
                <path d="M9 6l6 6-6 6" />
              </StepButton>
            </div>
          )}
        </div>
      </PanelHeader>

      {!minimized && (
        <div id={bodyId} className="flex flex-col gap-3">
          {points.length === 0 ? (
            <p className="text-body text-ink-muted">No walk planned yet. Plan one to be guided from stop to stop.</p>
          ) : (
            <NextStop
              heading={heading}
              points={points}
              aimed={aimed}
              stop={stops[aimed]}
              next={stops[aimed + 1] ?? null}
              slopeLimit={slopeLimit}
            />
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-body text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              Sun <ClassifiedValue value={shownSunElevation(sunElevationDeg)} format={describeSunElevation} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              Local solar time <ClassifiedValue value={localSolarTime(solar, position)} format={formatHours} />
            </span>
          </div>
        </div>
      )}
    </Panel>
  )
}

/**
 * The stop aimed at: the dial, its name, distance and bearing, then the leg
 * ahead's radiation glyph, slope and flag. Walking to the stop, the leg
 * ahead is the one into it. Once it is reached that leg is behind, so they
 * show the leg on to the next stop, which waits for Next; at the last stop
 * no leg is ahead, so none show.
 */
function NextStop({
  heading,
  points,
  aimed,
  stop,
  next,
  slopeLimit,
}: {
  heading: Classified<number>
  points: readonly WayPoint[]
  aimed: number
  /** The stop aimed at: its leg is the one into it. */
  stop: HudStop
  /** The stop after it, or null at the last. */
  next: HudStop | null
  slopeLimit: SlopeLimit
}) {
  const point = points[aimed]
  const arrived = isReached(point)
  const distance = shownDistance(point.distanceKm)
  const ahead = arrived ? next : stop
  return (
    <div className="flex items-start gap-3">
      <Arrow label={point.label} angle={pointerAngle(heading, point.bearingDeg)} distance={distance} arrived={arrived} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The name has the row to itself; one too long for it is cut, and the dial's title names it in full. */}
        <p aria-live="polite" className="truncate text-body text-ink">
          {arrived ? `${point.label} reached` : `To ${point.label}`}
        </p>
        {arrived && next !== null && (
          <p className="text-caption text-ink-muted">{`Press Next stop to walk on to ${next.label}.`}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ClassifiedValue value={distance} format={formatWayDistance} />
          <span className="inline-flex items-center gap-1.5 text-body text-ink-muted">
            Bearing <ClassifiedValue value={point.bearingDeg} format={formatBearing} />
          </span>
          {ahead !== null && <RadiationHudGlyph nextLegHazards={ahead.legHazards} />}
        </div>
        {ahead !== null && (
          <SlopeAhead
            slope={ahead.steepestSlopeDeg}
            legHazards={ahead.legHazards}
            limit={slopeLimit}
            to={arrived ? ahead.label : null}
          />
        )}
        <p className="text-caption text-ink-subtle">Points straight at the stop. Not a guarantee of safe ground.</p>
      </div>
    </div>
  )
}

/**
 * The steepest slope of the leg ahead, in the elevation chart's bands,
 * and below it the planner's flag when it is over the limit, as the
 * stop card shows it. The flag also reads the leg's measured
 * stretches, so a leg with ground left unchecked still shows one it knows is
 * over (`legSlopeToFlag`).
 */
function SlopeAhead({
  slope,
  legHazards,
  limit,
  to,
}: {
  slope: Classified<number>
  legHazards: Classified<Hazard[]>
  limit: SlopeLimit
  /** The next stop's name once the one aimed at is reached, so the row says which leg it is about. */
  to: string | null
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex flex-wrap items-center gap-1.5 text-body text-ink-muted">
        {to === null ? 'Steepest on the way' : `Steepest on the way to ${to}`}
        <ClassifiedValue value={shownSlope(slope)} format={formatSlope} />
      </p>
      <SlopeLimitFlag slope={legSlopeToFlag(slope, legHazards)} limit={limit} />
    </div>
  )
}

/**
 * The dial: an arrow turned to the stop, the empty ring when there is no
 * direction (never an arrow at a default angle, as with the compass), and a
 * dot once the last stop is reached. Its accessible name says the stop, its
 * distance and the direction; the direction and its method are also
 * the mark's tooltip.
 */
function Arrow({
  label,
  angle,
  distance,
  arrived,
}: {
  label: string
  angle: Classified<number>
  distance: Classified<number>
  arrived: boolean
}) {
  const words = arrived
    ? `${label} reached: within ${formatWayDistance(ARRIVAL_KM)}`
    : isAvailable(angle)
      ? `${directionText(angle.value)}. ${angle.classification === 'DERIVED' ? angle.method : angle.source}`
      : `Direction unavailable: ${angle.reason}`
  const away = isAvailable(distance) ? formatWayDistance(distance.value) : 'distance unavailable'
  return (
    <div className="relative shrink-0 rounded-full border border-line/60 bg-surface/70 p-1">
      <svg viewBox="-50 -50 100 100" className="size-14 text-ink" role="img">
        <title>{`Way to ${label}, ${away}. ${words}`}</title>
        <circle r={44} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
        {arrived ? (
          <circle data-arrived="" r={9} className="fill-accent" />
        ) : (
          isAvailable(angle) && (
            <path data-arrow="" transform={`rotate(${angle.value})`} d="M 0,-34 L 15,14 L 0,4 L -15,14 Z" className="fill-accent" />
          )
        )}
      </svg>
      {!arrived && (
        <span className="absolute -bottom-1 -right-1">
          <ClassificationBadge classification={angle.classification} detail={words} />
        </span>
      )}
    </div>
  )
}

/**
 * Keeps Space and the arrow keys to itself (`data-own-keys`), so they press
 * the button, not walk. At the first or last stop it is `aria-disabled`,
 * not `disabled`: pressing Next onto the last stop leaves focus on Next,
 * instead of the browser dropping it to the page.
 */
function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled}
      data-own-keys=""
      onClick={disabled ? undefined : onClick}
      className="flex size-7 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-muted"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}
