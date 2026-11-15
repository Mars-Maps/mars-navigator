import {
  SHIELDING_METHOD,
  SHIELDING_WARNING_FRACTION,
  derived,
  isAvailable,
  unavailable,
  type Classified,
  type Hazard,
  type HazardKind,
  type SurfacePoint,
} from '../../domain'
import { legShieldingHazards } from './atmosphericShielding'
import type { ProfilePoint } from './elevationProfile'
import { surfaceDistanceKm } from './routeDistance'

/**
 * Scans a route for one kind of hazard to a human on the surface.
 * Thresholds must come from a cited source; none
 * is invented here.
 */
export interface HazardDetector {
  kind: HazardKind
  /** Data, and a cited threshold source, this detector needs. Doubles as its TODO. */
  requires: readonly string[]
  /** Whether the detector is built; a stub is not, and a scan names it as not scanned. */
  ready: boolean
  detect(points: readonly SurfacePoint[]): Classified<Hazard[]>
}

/** Why a hazard scan is UNAVAILABLE. Exported so the UI can tell the cases apart. */
export const HAZARD_REASONS = {
  empty: 'The route has no points',
  /** No detector could run on these points: nothing was scanned, so nothing is "none found". */
  nothingScanned: 'Nothing was scanned',
} as const

/** A detector that cannot run yet. */
const stub = (kind: HazardKind, requires: readonly string[]): HazardDetector => ({
  kind,
  requires,
  ready: false,
  detect: () => unavailable(`${kind} detection not implemented`),
})

/** Why the radiation scan could not run: the points carry no height to derive the shielding from. */
export const NO_HEIGHTS_FOR_SHIELDING =
  "No point of this route has a height, so the atmospheric shielding along it was not checked (the straight-line option, and a route still being searched, carry none; a searched route's path does)"

/**
 * Radiation along a route's points: each point with a height checked
 * for atmospheric shielding under the warning fraction of Gale's column,
 * with the same rule and words as a walk leg.
 * Points with no height are "not checked" hazards, never an all-clear. With
 * no height anywhere the scan is UNAVAILABLE: nothing was checked.
 */
export const radiationDetector: HazardDetector = {
  kind: 'radiation',
  requires: ['Heights on the route\'s points, from the elevation chain'],
  ready: true,
  detect(points) {
    const heights = points.map((p) => (isAvailable(p.elevationMeters) ? p.elevationMeters.value : Number.NaN))
    if (!heights.some(Number.isFinite)) return unavailable(NO_HEIGHTS_FOR_SHIELDING)
    const samples: ProfilePoint[] = []
    let km = 0
    points.forEach((p, i) => {
      if (i > 0) km += surfaceDistanceKm(points[i - 1].coordinate, p.coordinate)
      samples.push({ coordinate: p.coordinate, distanceKm: km })
    })
    const sourceAt = (i: number) => {
      const h = points[i].elevationMeters
      return h.classification === 'DERIVED' ? h.method : h.classification === 'UNAVAILABLE' ? h.reason : h.source
    }
    return derived(
      legShieldingHazards(samples, heights, 'route', sourceAt, 'the route'),
      `Each point with a height checked for atmospheric shielding under ${SHIELDING_WARNING_FRACTION} of Gale's column. ${SHIELDING_METHOD}`,
    )
  },
}

/** One detector per HazardKind. A Record so a new kind fails to compile until added. */
export const HAZARD_DETECTORS: Record<HazardKind, HazardDetector> = {
  // TODO: needs elevation/slope samples along the route and a cited
  // safe-slope limit for a walking human.
  slope: stub('slope', [
    'Elevation or slope samples along the route',
    'A cited safe-slope limit for a walking human',
  ]),
  // TODO: needs high-resolution elevation and a cited drop-height threshold.
  'sudden-drop': stub('sudden-drop', [
    'High-resolution elevation along the route',
    'A cited drop-height threshold',
  ]),
  // TODO: needs a dust / dust-storm dataset with times.
  dust: stub('dust', ['A dust or dust-storm dataset with times']),
  // The shielding rule on the route's heights; a dose stays out.
  radiation: radiationDetector,
  // TODO: needs surface temperature with local time and cited exposure limits.
  temperature: stub('temperature', [
    'Surface temperature data with local time',
    'Cited human exposure limits',
  ]),
  // TODO: needs the geologic map's line features along the route.
  'mapped-obstacle': stub('mapped-obstacle', [
    'Geologic map line features (ridge crests, rim crests, delta fronts) along the route',
  ]),
}

/** The kinds the detectors scan for today, and those they do not, so a view can say both. */
export const SCANNED_HAZARD_KINDS: readonly HazardKind[] = Object.values(HAZARD_DETECTORS)
  .filter((d) => d.ready)
  .map((d) => d.kind)
export const UNSCANNED_HAZARD_KINDS: readonly HazardKind[] = Object.values(HAZARD_DETECTORS)
  .filter((d) => !d.ready)
  .map((d) => d.kind)

/**
 * Every hazard along a route.
 *
 * Each detector that can run contributes its hazards; the method names the
 * kinds scanned and, one by one with its reason, the kinds not scanned, so
 * an empty DERIVED list never reads as "no hazards of any kind". When
 * no detector could run the result is UNAVAILABLE with every reason: nothing
 * was scanned, and nothing is "none found".
 */
export function detectHazards(
  points: readonly SurfacePoint[],
  detectors: Record<HazardKind, HazardDetector> = HAZARD_DETECTORS,
): Classified<Hazard[]> {
  return scanHazards(points, detectors).hazards
}

/**
 * `detectHazards` with the kinds whose detector ran on these points, for a
 * route whose coverage is its own (a detector given for that route alone):
 * a view then names what was scanned on this route, not what the table can.
 */
export function scanHazards(
  points: readonly SurfacePoint[],
  detectors: Record<HazardKind, HazardDetector> = HAZARD_DETECTORS,
): { hazards: Classified<Hazard[]>; scanned: HazardKind[] } {
  if (points.length === 0) return { hazards: unavailable(HAZARD_REASONS.empty), scanned: [] }

  const found: Hazard[] = []
  const kinds: HazardKind[] = []
  const scanned: string[] = []
  const notScanned: string[] = []
  for (const detector of Object.values(detectors)) {
    const result = detector.detect(points)
    if (!isAvailable(result)) {
      notScanned.push(`${detector.kind} (${result.reason})`)
      continue
    }
    found.push(...result.value)
    kinds.push(detector.kind)
    scanned.push(`${detector.kind}: ${result.classification === 'DERIVED' ? result.method : result.source}`)
  }
  if (scanned.length === 0) {
    return { hazards: unavailable(`${HAZARD_REASONS.nothingScanned}: ${notScanned.join('; ')}`), scanned: [] }
  }
  const coverage = notScanned.length === 0 ? '' : `. Not scanned: ${notScanned.join('; ')}`
  return { hazards: derived(found, `Scanned for ${scanned.join('; ')}${coverage}`), scanned: kinds }
}
