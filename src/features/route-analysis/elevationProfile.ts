import { derived, official, unavailable, type Classified, type MarsCoordinate } from '../../domain'
import { surfaceDistanceKm } from './routeDistance'

/** One point on the elevation chart: x = distanceKm, y = elevationMeters. */
export interface ElevationProfileSample {
  coordinate: MarsCoordinate
  /**
   * Cumulative great-circle distance from the start of the path, in km
   * (haversine on a spherical Mars, as routeLengthKm).
   */
  distanceKm: number
  /**
   * Ground elevation at this sample. An UNAVAILABLE sample is drawn as a gap
   * in the line — never as 0, and never interpolated from its neighbours.
   */
  elevationMeters: Classified<number>
}

/**
 * Elevation along a path, ready for a chart. Samples are ordered from the
 * start of the path and distanceKm never decreases.
 */
export interface ElevationProfile {
  samples: ElevationProfileSample[]
  totalDistanceKm: number
}

/** Paths shorter than this (1 µm) count as zero length. */
const ZERO_LENGTH_KM = 1e-9

/** Why a profile is UNAVAILABLE before any height is read. Exported so the UI can tell the cases apart. */
export const ELEVATION_PROFILE_REASONS = {
  empty: 'The path has no points',
  singlePoint: 'An elevation profile needs at least two points',
  zeroLength: 'All points are identical; the path has zero length',
  antipodal: 'Two consecutive points are antipodal; no single great-circle line joins them',
} as const

/**
 * The most samples a profile takes: about one per pixel of the
 * chart, and the cap on what one profile asks the elevation source for. A
 * north–south line costs one read per sample.
 */
export const PROFILE_MAX_SAMPLES = 200

/** Where a profile samples the terrain, and how far along the path that is. */
export interface ProfilePoint {
  coordinate: MarsCoordinate
  distanceKm: number
}

/** The sampling plan for a path: the points to read heights at, in order. */
export interface ProfilePlan {
  points: ProfilePoint[]
  totalDistanceKm: number
  /** Mean distance between consecutive samples, km. */
  spacingKm: number
}

export interface ProfilePlanOptions {
  maxSamples?: number
  /** The elevation source's cell size, km: sampling finer than this reads the same cells twice. */
  minSpacingKm?: number
}

/**
 * Where a profile samples the terrain along `path`, before any height is
 * read. Geometry is checked first: an empty or single-point path, a
 * zero-length one and an antipodal leg are UNAVAILABLE with their reasons.
 * Then the path is sampled along its great-circle legs, about every
 * `minSpacingKm` up to `maxSamples` in all, every waypoint included so the
 * chart's corners are real points; consecutive duplicate waypoints add
 * nothing. DERIVED, with the count and spacing as its method, which the
 * finished profile carries on.
 */
export function planProfile(
  path: readonly MarsCoordinate[],
  { maxSamples = PROFILE_MAX_SAMPLES, minSpacingKm = 0 }: ProfilePlanOptions = {},
): Classified<ProfilePlan> {
  if (path.length === 0) return unavailable(ELEVATION_PROFILE_REASONS.empty)
  if (path.length === 1) return unavailable(ELEVATION_PROFILE_REASONS.singlePoint)

  const legs: { from: MarsCoordinate; to: MarsCoordinate; km: number }[] = []
  let totalKm = 0
  for (let i = 1; i < path.length; i++) {
    const km = surfaceDistanceKm(path[i - 1], path[i])
    // Not `=== 0`: haversine leaves ~1e-13 km of floating-point error between
    // equivalent coordinates such as 0°E and 360°E.
    if (km < ZERO_LENGTH_KM) continue
    legs.push({ from: path[i - 1], to: path[i], km })
    totalKm += km
  }
  if (totalKm < ZERO_LENGTH_KM) return unavailable(ELEVATION_PROFILE_REASONS.zeroLength)
  if (legs.some((leg) => isAntipodal(leg.from, leg.to))) return unavailable(ELEVATION_PROFILE_REASONS.antipodal)

  const byCell = minSpacingKm > 0 ? Math.floor(totalKm / minSpacingKm) + 1 : maxSamples
  const target = Math.max(2, Math.min(maxSamples, byCell))
  const nominalSpacingKm = totalKm / (target - 1)

  const points: ProfilePoint[] = [{ coordinate: normalise(legs[0].from), distanceKm: 0 }]
  let startKm = 0
  for (const leg of legs) {
    const intervals = Math.max(1, Math.round(leg.km / nominalSpacingKm))
    for (let i = 1; i <= intervals; i++) {
      const t = i / intervals
      points.push({
        coordinate: i === intervals ? normalise(leg.to) : pointAlong(leg.from, leg.to, t),
        distanceKm: startKm + leg.km * t,
      })
    }
    startKm += leg.km
  }
  const spacingKm = totalKm / (points.length - 1)
  return derived(
    { points, totalDistanceKm: totalKm, spacingKm },
    `${points.length} samples about every ${describeSpacing(spacingKm)} along the great-circle legs between the waypoints, every waypoint included`,
  )
}

/** The plan's coordinates as (latitude, longitude °E) pairs, the shape the elevation source reads. */
export function profilePointPairs(plan: ProfilePlan): Float64Array {
  const pairs = new Float64Array(plan.points.length * 2)
  plan.points.forEach((p, i) => {
    pairs[i * 2] = p.coordinate.latitude
    pairs[i * 2 + 1] = p.coordinate.longitudeEast
  })
  return pairs
}

/** The words for where each height came from, and why one is missing. */
export interface HeightProvenance {
  /** The source line of a nearest-cell height, as the elevation source states it. */
  source: string
  /** Why a sample has no height when its cell is marked no-data. */
  noDataReason: string
}

/**
 * The profile from a plan and the heights read at its points, one per
 * point in order. Each height is OFFICIAL with its source; a NaN,
 * the source's mark for a no-data cell, is an UNAVAILABLE sample, drawn as
 * a gap. An UNAVAILABLE plan or read passes its reason through, so the chart
 * says why; a read of the wrong length is refused rather than misaligned.
 * The profile is DERIVED: the plan's sampling, then the cells' source.
 */
export function profileFromHeights(
  plan: Classified<ProfilePlan>,
  heights: Classified<Float32Array>,
  provenance: HeightProvenance,
): Classified<ElevationProfile> {
  if (plan.classification === 'UNAVAILABLE') return plan
  if (heights.classification === 'UNAVAILABLE') return heights
  const { points, totalDistanceKm } = plan.value
  if (heights.value.length !== points.length) {
    return unavailable(`The elevation source answered ${heights.value.length} heights for ${points.length} samples`)
  }
  const samples: ElevationProfileSample[] = points.map((p, i) => {
    const h = heights.value[i]
    return {
      coordinate: p.coordinate,
      distanceKm: p.distanceKm,
      elevationMeters: Number.isNaN(h) ? unavailable(provenance.noDataReason) : official(h, provenance.source),
    }
  })
  const sampling = plan.classification === 'DERIVED' ? plan.method : plan.source
  return derived({ samples, totalDistanceKm }, `${sampling}; each height is the ${provenance.source}`)
}

function describeSpacing(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`
  if (km >= 1) return `${km.toFixed(1)} km`
  return `${(km * 1000).toFixed(0)} m`
}

type Vec3 = readonly [number, number, number]

const toRadians = (deg: number) => (deg * Math.PI) / 180
const toDegrees = (rad: number) => (rad * 180) / Math.PI

function unitVector(c: MarsCoordinate): Vec3 {
  const lat = toRadians(c.latitude)
  const lon = toRadians(c.longitudeEast)
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

/** The angle between two points' unit vectors, from their chord: exact for the smallest angles, where acos is not. */
function angleBetween(a: Vec3, b: Vec3): number {
  const chord = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  return 2 * Math.asin(Math.min(1, chord / 2))
}

/** Within a nanoradian of opposite: every great circle through both is as short as any other. */
const ANTIPODAL_RAD = 1e-9

function isAntipodal(a: MarsCoordinate, b: MarsCoordinate): boolean {
  return Math.PI - angleBetween(unitVector(a), unitVector(b)) < ANTIPODAL_RAD
}

/** The longitude in [0, 360): 360°E is 0°E, and −0 is 0. */
function normalise(c: MarsCoordinate): MarsCoordinate {
  return { latitude: c.latitude, longitudeEast: (((c.longitudeEast % 360) + 360) % 360) + 0 }
}

/**
 * The point a fraction `t` of the way from `a` to `b` along the shorter
 * great-circle arc: spherical linear interpolation of their unit vectors.
 * `t` = 0 is `a` and 1 is `b`; equal points give `a`. Antipodal points have
 * no shorter arc, and `planProfile` refuses them before asking.
 */
export function pointAlong(a: MarsCoordinate, b: MarsCoordinate, t: number): MarsCoordinate {
  const va = unitVector(a)
  const vb = unitVector(b)
  const omega = angleBetween(va, vb)
  if (omega < 1e-12) return normalise(a)
  const s = Math.sin(omega)
  const wa = Math.sin((1 - t) * omega) / s
  const wb = Math.sin(t * omega) / s
  const x = wa * va[0] + wb * vb[0]
  const y = wa * va[1] + wb * vb[1]
  const z = wa * va[2] + wb * vb[2]
  const latitude = toDegrees(Math.asin(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z)))))
  return normalise({ latitude, longitudeEast: toDegrees(Math.atan2(y, x)) })
}
