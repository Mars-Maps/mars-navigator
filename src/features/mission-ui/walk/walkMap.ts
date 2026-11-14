import {
  HAZARD_NOT_CHECKED,
  MARS_MEAN_RADIUS_KM,
  isAvailable,
  type Hazard,
  type MarsCoordinate,
  type WalkLeg,
  type WalkPlan,
} from '../../../domain'

export interface MapPoint {
  x: number
  y: number
}

export interface WalkMapFlag extends MapPoint {
  id: string
  kind: 'slope' | 'obstacle'
}

export interface WalkMapLeg {
  points: MapPoint[]
  /** Its slope or its map was not read, so a clean line here would read as clear when nobody looked. */
  notFullyChecked: boolean
}

/** A plan laid out for a small north-up map, in the units of `width` and `height`. */
export interface WalkMapLayout {
  /** One per leg that has a path; a leg without one draws nothing. */
  legs: WalkMapLeg[]
  stops: MapPoint[]
  flags: WalkMapFlag[]
  scale: { km: number; length: number }
}

const KM_PER_DEG = (Math.PI * MARS_MEAN_RADIUS_KM) / 180
/** A plan with no extent still gets a map this many km across, never a divide by zero. */
const MIN_SPAN_KM = 0.1
/** The scale bar is at most this share of the width. */
const MAX_SCALE_SHARE = 0.4

/** Only flags the panel gives a place for: a figure or a map's wording. "Not checked" has no place, and radiation is not a spot on the ground. */
function mapFlagKind(hazard: Hazard): WalkMapFlag['kind'] | null {
  if (hazard.kind === 'mapped-obstacle') return hazard.unit === HAZARD_NOT_CHECKED ? null : 'obstacle'
  if (hazard.kind === 'slope') return isAvailable(hazard.magnitude) ? 'slope' : null
  return null
}

/** No steepest slope, no flag list, or a slope or map row saying it was not checked. */
function isNotFullyChecked(leg: WalkLeg): boolean {
  if (!isAvailable(leg.steepestSlopeDeg) || !isAvailable(leg.hazards)) return true
  return leg.hazards.value.some((hazard) =>
    hazard.kind === 'mapped-obstacle'
      ? hazard.unit === HAZARD_NOT_CHECKED
      : hazard.kind === 'slope' && !isAvailable(hazard.magnitude),
  )
}

/** The largest 1, 2 or 5 × 10ⁿ km no longer than `km`. */
export function niceScaleKm(km: number): number {
  const power = 10 ** Math.floor(Math.log10(km))
  const lead = km / power
  return (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * power
}

/**
 * Lays a plan out north-up: an equirectangular projection about the
 * first stop, one scale on both axes, which at the few km of a walk differs
 * from the sphere by far less than a pixel. Longitudes are taken as the short
 * way from the first stop, so a walk across 0°E stays together. Every position
 * is the plan's own; nothing is added between them.
 */
export function walkMapLayout(plan: WalkPlan, width: number, height: number, padding: number): WalkMapLayout {
  const origin = plan.stops[0].coordinate
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180)
  const toKm = (c: MarsCoordinate): MapPoint => {
    const dLon = ((c.longitudeEast - origin.longitudeEast + 540) % 360) - 180
    return { x: dLon * cosLat * KM_PER_DEG, y: (c.latitude - origin.latitude) * KM_PER_DEG }
  }

  const legsKm = plan.legs.flatMap((leg) =>
    isAvailable(leg.path) && leg.path.value.length >= 2
      ? [{ points: leg.path.value.map(toKm), notFullyChecked: isNotFullyChecked(leg) }]
      : [],
  )
  const stopsKm = plan.stops.map((s) => toKm(s.coordinate))
  const flagsKm: (WalkMapFlag & MapPoint)[] = []
  for (const leg of plan.legs) {
    if (!isAvailable(leg.hazards)) continue
    for (const hazard of leg.hazards.value) {
      const kind = mapFlagKind(hazard)
      if (kind) flagsKm.push({ id: hazard.id, kind, ...toKm(hazard.coordinate) })
    }
  }

  const all = [...legsKm.flatMap((leg) => leg.points), ...stopsKm, ...flagsKm]
  const minX = Math.min(...all.map((p) => p.x))
  const maxX = Math.max(...all.map((p) => p.x))
  const minY = Math.min(...all.map((p) => p.y))
  const maxY = Math.max(...all.map((p) => p.y))
  const unitsPerKm = Math.min(
    (width - 2 * padding) / Math.max(maxX - minX, MIN_SPAN_KM),
    (height - 2 * padding) / Math.max(maxY - minY, MIN_SPAN_KM),
  )
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const place = (p: MapPoint): MapPoint => ({
    x: width / 2 + (p.x - midX) * unitsPerKm,
    // North is up, and the screen's y runs down.
    y: height / 2 - (p.y - midY) * unitsPerKm,
  })

  const scaleKm = niceScaleKm((width * MAX_SCALE_SHARE) / unitsPerKm)
  return {
    legs: legsKm.map((leg) => ({ ...leg, points: leg.points.map(place) })),
    stops: stopsKm.map(place),
    flags: flagsKm.map((f) => ({ id: f.id, kind: f.kind, ...place(f) })),
    scale: { km: scaleKm, length: scaleKm * unitsPerKm },
  }
}
