import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { isAvailable, type Classified, type DataClassification } from '../../../domain'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { useRouteHover, type HoveredRoutePoint } from '../../../state'
import type {
  ElevationProfile,
  ElevationProfileSample,
} from '../../route-analysis/elevationProfile'
import { describeSlope, SLOPE_BANDS, SLOPE_METHOD, slopeDegrees, type SlopeBand } from '../../route-analysis/profileSlope'
import {
  elevationExtent,
  routePointOf,
  sampleIndexAtPointer,
  splitAtGaps,
  splitByBand,
  stepIndex,
} from './profileChart'

/**
 * Elevation along the active route; `null` means no route is planned. The
 * shell reads the profile from the elevation source (`useProfile` in
 * `src/app/`). While it samples, and whenever it cannot, the
 * profile is UNAVAILABLE and the panel says why instead of drawing empty
 * axes that would read as flat ground. The sample under the chart's pointer
 * goes to the route-hover store, so the globe marks it on the route.
 */
export function ElevationProfileView({
  profile,
}: {
  profile: Classified<ElevationProfile> | null
}) {
  const { minimized, toggle, bodyId } = useMinimized()
  const setHoveredRoutePoint = useRouteHover((s) => s.setHoveredRoutePoint)
  // No ×: End navigation closes the navigation panels.
  return (
    <Panel surface="glass" compact>
      {/* The marks beside the heading, outside it so the heading's name stays
          "Elevation profile". */}
      <PanelHeader
        title="Elevation profile"
        minimized={minimized}
        onToggleMinimized={toggle}
        bodyId={bodyId}
        spacing="mb-2"
      >
        <div className="flex items-center gap-1.5">
          <h2 className="text-body font-semibold text-ink">Elevation profile</h2>
          <ProfileHeaderMarks profile={profile} minimized={minimized} />
        </div>
      </PanelHeader>
      {minimized ? null : (
        <div id={bodyId}>
          {profile ? (
            <ElevationProfileBody profile={profile} onHoverPoint={setHoveredRoutePoint} />
          ) : (
            <p className="text-body text-ink-muted">No route planned</p>
          )}
        </div>
      )}
    </Panel>
  )
}

/**
 * The chart, or its hatched unavailable frame with the reason. Exported so
 * the Terrain Profile tool draws a line between two points the same
 * way, inside its own panel. `onHoverPoint` hears the route point under the
 * pointer or arrow-key cursor, and null when there is none; the
 * Terrain Profile tool passes none, since its line is not a route.
 */
export function ElevationProfileBody({
  profile,
  onHoverPoint,
}: {
  profile: Classified<ElevationProfile>
  onHoverPoint?: (point: HoveredRoutePoint | null) => void
}) {
  if (profile.classification === 'UNAVAILABLE') {
    return <UnavailableFrame reason={profile.reason} />
  }

  return (
    <ProfileChart
      profile={profile.value}
      simulated={profile.classification === 'SIMULATED'}
      onHoverPoint={onHoverPoint}
    />
  )
}

/**
 * What a slope computed from two heights is: DERIVED from official or
 * derived heights, SIMULATED when either height is (a figure built on
 * invented data is invented too).
 */
function slopeClassification(...from: DataClassification[]): DataClassification {
  return from.includes('SIMULATED') ? 'SIMULATED' : 'DERIVED'
}

/** The reason when a profile exists but none of its samples has an elevation. */
export const NO_SAMPLE_ELEVATION_REASON = 'No sample along this line has elevation data'

/**
 * The profile while its heights are being read: UNAVAILABLE, never a blank
 * or a flat line. The shell's `useProfile` answers with it; it lives here so
 * the frame can say "loading" rather than "unavailable" for it, since a
 * feature may not import from `src/app/`.
 */
export const SAMPLING_REASON = 'Sampling the terrain along the path…'

/**
 * The profile's provenance beside a panel's heading. Open, an unavailable
 * profile says so in the body. Minimised, the bar keeps the
 * UNAVAILABLE mark instead, as Hazards does, so a folded panel never hides
 * that there is no data: for a profile UNAVAILABLE as a whole, and for
 * one whose samples are all gaps. Exported so the Terrain Profile
 * tool's bar follows the same rule, and so tests can render it folded.
 */
export function ProfileHeaderMarks({
  profile,
  minimized,
}: {
  profile: Classified<ElevationProfile> | null
  minimized: boolean
}) {
  if (!profile) return null
  if (profile.classification === 'UNAVAILABLE') {
    return minimized ? (
      <ClassificationBadge classification="UNAVAILABLE" detail={profile.reason} />
    ) : null
  }

  const noSampleElevation =
    minimized && elevationExtent(splitAtGaps(profile.value.samples)) === null
  return (
    <>
      <ClassificationBadge
        classification={profile.classification}
        detail={profile.classification === 'DERIVED' ? profile.method : profile.source}
      />
      {noSampleElevation && (
        <ClassificationBadge classification="UNAVAILABLE" detail={NO_SAMPLE_ELEVATION_REASON} />
      )}
    </>
  )
}

/**
 * The chart's height, so the panel keeps its shape when data arrives.
 * A hatched box, not an SVG: no baseline or axis that could read as 0 m.
 * The reason is in the mark's tooltip. One component for both ways
 * a profile can have nothing to draw, so they cannot drift apart.
 * While the heights are still being read it says "loading": no data yet,
 * but not a dead end.
 */
function UnavailableFrame({ reason }: { reason: string }) {
  return (
    <p className="flex h-24 items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong bg-[repeating-linear-gradient(135deg,var(--color-line)_0_1px,transparent_1px_8px)] text-body text-ink-muted">
      {reason === SAMPLING_REASON ? 'Elevation loading…' : 'Elevation unavailable'}
      <ClassificationBadge classification="UNAVAILABLE" detail={reason} />
    </p>
  )
}

const VIEW_W = 512
const VIEW_H = 120
/** Headroom above the highest and below the lowest sample, as a share of the range, so the line never sits on the frame. */
const Y_PAD = 0.08
/** The line's width in px (non-scaling), 2 px as the reference mark spec. */
const LINE_PX = 2

// A fixed locale so the thousands separator does not depend on the browser.
const formatMeters = (m: number) => `${Math.round(m).toLocaleString('en-US')} m`
const formatDistance = (km: number) =>
  km < 1 ? formatMeters(km * 1000) : `${km.toFixed(1)} km`
// Always km in the readout: "250 m · 1,200 m" would read as two elevations.
const formatReadoutDistance = (km: number) => `${km.toFixed(km < 1 ? 2 : 1)} km`

/** The line's colour per slope band; a stretch with no slope is plain ink. */
const STROKE: Record<SlopeBand, string> = {
  gentle: 'stroke-slope-gentle',
  moderate: 'stroke-slope-moderate',
  steep: 'stroke-slope-steep',
}
const SWATCH: Record<SlopeBand, string> = {
  gentle: 'bg-slope-gentle',
  moderate: 'bg-slope-moderate',
  steep: 'bg-slope-steep',
}

/**
 * Distance on x, elevation on y. A sample without elevation breaks the line:
 * it is a gap, never 0 and never interpolated from its neighbours. Each
 * stretch between two samples is coloured by its slope band; the
 * legend and the readout say the band in words, so colour is never the only
 * signal.
 */
function ProfileChart({
  profile,
  simulated,
  onHoverPoint,
}: {
  profile: ElevationProfile
  simulated: boolean
  onHoverPoint?: (point: HoveredRoutePoint | null) => void
}) {
  // The sample under the pointer or the arrow-key cursor. React skips
  // the render when the index is unchanged, so moving within one sample's
  // reach costs nothing.
  const [active, setActive] = useState<number | null>(null)
  // `?? null`: a new route can arrive while an index from the old one is held.
  const activeSample = active === null ? null : (profile.samples[active] ?? null)

  // Publish the active sample's place on the route. Keyed on the
  // sample, so a new route under a held index publishes its own point.
  useEffect(() => {
    onHoverPoint?.(routePointOf(activeSample))
  }, [activeSample, onHoverPoint])
  // Unmounting clears it: minimising, an unavailable profile, or the end of
  // navigation, which takes the panel away.
  useEffect(() => () => onHoverPoint?.(null), [onHoverPoint])

  // x divides by the total distance. `elevationProfile` never returns a
  // zero-length profile as available, but the view takes any profile, so it
  // refuses to draw one rather than plot NaN or Infinity.
  if (!(profile.totalDistanceKm > 0)) {
    return (
      <p className="text-body text-ink-muted">
        The route has no length, so there is no profile to draw.
      </p>
    )
  }

  const segments = splitAtGaps(profile.samples)
  const extent = elevationExtent(segments)

  // Every sample is a gap: unavailable, like a profile that is UNAVAILABLE
  // as a whole, so the panel's only mark is not the header's DERIVED.
  if (!extent) return <UnavailableFrame reason={NO_SAMPLE_ELEVATION_REASON} />

  // Labels show the real extremes. Only the scale is padded: a flat profile
  // gets a non-zero range to draw against without inventing values, and
  // every profile gets headroom so its extremes sit inside the frame.
  const { min, max } = extent
  const span = min === max ? 2 : max - min
  const lo = (min === max ? min - 1 : min) - span * Y_PAD
  const hi = (min === max ? max + 1 : max) + span * Y_PAD

  const x = (km: number) => (km / profile.totalDistanceKm) * VIEW_W
  const y = (m: number) => VIEW_H - ((m - lo) / (hi - lo)) * VIEW_H
  const availableCount = segments.reduce((n, s) => n + s.length, 0)
  const hasGaps = availableCount < profile.samples.length

  const previousSample = active === null || active === 0 ? null : (profile.samples[active - 1] ?? null)
  const select = (i: number) => setActive(i < 0 ? null : i)

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    select(sampleIndexAtPointer(profile.samples, profile.totalDistanceKm, e.clientX - box.left, box.width))
  }

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    e.preventDefault()
    select(stepIndex(active, delta, profile.samples.length))
  }

  return (
    <figure>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-micro tabular-nums text-ink-subtle">
          <span>{formatMeters(max)}</span>
          <span>{formatMeters(min)}</span>
        </div>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          // min-w-0: with a height and a viewBox the SVG has an intrinsic
          // width (96 px × 512/120 ≈ 410 px), which a flex item will not
          // shrink below by default, so the chart ran past the panel.
          className="h-24 min-w-0 flex-1 cursor-crosshair overflow-visible text-ink"
          role="img"
          aria-label={`${
            min === max
              ? `Elevation ${formatMeters(min)} throughout ${formatDistance(profile.totalDistanceKm)}`
              : `Elevation from ${formatMeters(min)} to ${formatMeters(max)} over ${formatDistance(profile.totalDistanceKm)}`
          }. Arrow keys read each sample`}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <rect
            width={VIEW_W}
            height={VIEW_H}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            vectorEffect="non-scaling-stroke"
          />
          {segments.map((segment, i) =>
            segment.length === 1 ? (
              // An isolated sample has no neighbour to join; draw it as a dot.
              // A zero-length round-capped stroke, so preserveAspectRatio="none"
              // cannot stretch it into an ellipse the way it would a circle.
              <path
                key={i}
                d={`M ${x(segment[0].km)},${y(segment[0].m)} h 0`}
                stroke="currentColor"
                strokeWidth={4}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              splitByBand(segment).map((run, j) => (
                <polyline
                  key={`${i}-${j}`}
                  points={run.points.map((p) => `${x(p.km)},${y(p.m)}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  className={run.band === null ? undefined : STROKE[run.band]}
                  strokeWidth={LINE_PX}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))
            ),
          )}
          {activeSample && (
            <g className="text-accent" pointerEvents="none">
              <line
                x1={x(activeSample.distanceKm)}
                x2={x(activeSample.distanceKm)}
                y1={0}
                y2={VIEW_H}
                stroke="currentColor"
                strokeOpacity={0.6}
                vectorEffect="non-scaling-stroke"
              />
              {/* No dot on a gap: there is no elevation to place it at. */}
              {isAvailable(activeSample.elevationMeters) && (
                <path
                  d={`M ${x(activeSample.distanceKm)},${y(activeSample.elevationMeters.value)} h 0`}
                  stroke="currentColor"
                  strokeWidth={6}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          )}
        </svg>
      </div>
      {/* h-5 fits the badge, so the row does not jump when the readout appears. */}
      <figcaption className="mt-1 flex h-5 items-center justify-between gap-2 text-micro tabular-nums text-ink-subtle">
        <span>0 km</span>
        <span role="status">
          {activeSample ? (
            <SampleReadout sample={activeSample} previous={previousSample} />
          ) : (
            hasGaps && 'Gaps: no elevation data'
          )}
        </span>
        <span>{formatDistance(profile.totalDistanceKm)}</span>
      </figcaption>
      <SlopeLegend classification={simulated ? 'SIMULATED' : 'DERIVED'} />
    </figure>
  )
}

/** The three bands with their thresholds, and the mark that says how a slope is read. */
function SlopeLegend({ classification }: { classification: DataClassification }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-ink-subtle">
      <span>Slope</span>
      {SLOPE_BANDS.map(({ band, label }) => (
        <span key={band} className="flex items-center gap-1">
          <span aria-hidden="true" className={`inline-block h-0.5 w-3 rounded-full ${SWATCH[band]}`} />
          {band} {label}
        </span>
      ))}
      <ClassificationBadge classification={classification} detail={SLOPE_METHOD} />
    </p>
  )
}

/**
 * One sample's distance and elevation. A sample without elevation
 * reads "Elevation unavailable", with its reason on hover; never a number.
 * With `previous`, the slope of the stretch that ends here and its band,
 * when both ends have a height.
 */
export function SampleReadout({
  sample,
  previous = null,
}: {
  sample: ElevationProfileSample
  previous?: ElevationProfileSample | null
}) {
  const e = sample.elevationMeters
  const stretch =
    previous && isAvailable(previous.elevationMeters) && isAvailable(e)
      ? {
          text: describeSlope(slopeDegrees(e.value - previous.elevationMeters.value, sample.distanceKm - previous.distanceKm)),
          classification: slopeClassification(e.classification, previous.elevationMeters.classification),
        }
      : null
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-ink">{formatReadoutDistance(sample.distanceKm)}</span>
      <span aria-hidden="true">·</span>
      {isAvailable(e) ? (
        <span className="text-ink">{formatMeters(e.value)}</span>
      ) : (
        <span className="italic" title={e.reason}>
          Elevation unavailable
        </span>
      )}
      <ClassificationBadge
        classification={e.classification}
        detail={!isAvailable(e) ? e.reason : e.classification === 'DERIVED' ? e.method : e.source}
      />
      {stretch?.text && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-ink">{stretch.text}</span>
          <ClassificationBadge classification={stretch.classification} detail={SLOPE_METHOD} />
        </>
      )}
    </span>
  )
}
