import { MARS_MEAN_RADIUS_KM, type MarsCoordinate, type SurfacePoint } from '../../domain'

/**
 * How far from a marked point a right-click may land and still mean it,
 * CSS px on screen. About the height of the pin above its tip (the
 * sprite is 56 px), so a right-click on the pin itself or beside its foot
 * counts, and one a pin's length away does not.
 */
export const NEAR_MARKER_PX = 28

/**
 * The marked point closest to `pick` within `tolerancePx` of it on screen,
 * or null. `kmPerPx` is the scale bar's figure for the current
 * camera, so the tolerance is the same number of pixels at every zoom;
 * null before the camera has settled once, when nothing can be near.
 *
 * The distance is the great-circle arc on the mean-radius sphere, from the
 * chord between the two points' unit vectors. It is a hit test, never a
 * shown value, and like the scale bar it is exact at the view centre and
 * approximate towards the limb, where a pixel covers more ground.
 */
export function nearbyMarker(
  markers: readonly SurfacePoint[],
  pick: MarsCoordinate,
  kmPerPx: number | null,
  tolerancePx: number = NEAR_MARKER_PX,
): SurfacePoint | null {
  if (kmPerPx === null || !(kmPerPx > 0) || !(tolerancePx >= 0)) return null
  const toleranceKm = tolerancePx * kmPerPx
  let best: SurfacePoint | null = null
  let bestKm = Infinity
  for (const marker of markers) {
    const km = arcKm(pick, marker.coordinate)
    if (km <= toleranceKm && km < bestKm) {
      best = marker
      bestKm = km
    }
  }
  return best
}

/** A route draft's pin the menu can act on: which end, or which stop by its index in `stops`. */
export type RoutePin =
  | { kind: 'departure' | 'destination'; coordinate: MarsCoordinate }
  | { kind: 'stop'; index: number; coordinate: MarsCoordinate }

/**
 * The route pin closest to `pick` within `tolerancePx` of it on screen, or
 * null: the same hit test as `nearbyMarker`, over the draft's chosen
 * departure, stops and destination.
 */
export function nearbyRoutePin(
  draft: {
    departure: MarsCoordinate | null
    stops: readonly (MarsCoordinate | null)[]
    destination: MarsCoordinate | null
  },
  pick: MarsCoordinate,
  kmPerPx: number | null,
  tolerancePx: number = NEAR_MARKER_PX,
): RoutePin | null {
  if (kmPerPx === null || !(kmPerPx > 0) || !(tolerancePx >= 0)) return null
  const pins: RoutePin[] = []
  if (draft.departure) pins.push({ kind: 'departure', coordinate: draft.departure })
  draft.stops.forEach((stop, index) => stop && pins.push({ kind: 'stop', index, coordinate: stop }))
  if (draft.destination) pins.push({ kind: 'destination', coordinate: draft.destination })
  let best: RoutePin | null = null
  let bestKm = tolerancePx * kmPerPx
  for (const pin of pins) {
    const km = arcKm(pick, pin.coordinate)
    if (km <= bestKm) {
      best = pin
      bestKm = km
    }
  }
  return best
}

/** How the menu names a route pin, as the search bar names its rows: Departure, Stop 1 …, Destination. */
export function routePinName(pin: RoutePin): string {
  if (pin.kind === 'stop') return `Stop ${pin.index + 1}`
  return pin.kind === 'departure' ? 'Departure' : 'Destination'
}

const toRadians = (deg: number) => (deg * Math.PI) / 180

/**
 * Great-circle distance between two surface points, km: the angle between
 * their unit vectors from the chord between them, 2·asin(chord / 2). The
 * chord keeps its precision for the small angles a hit test cares about,
 * where acos of a dot product near 1 does not, and is exactly 0 for the
 * same point.
 */
function arcKm(a: MarsCoordinate, b: MarsCoordinate): number {
  const [ax, ay, az] = unitVector(a)
  const [bx, by, bz] = unitVector(b)
  const chord = Math.hypot(ax - bx, ay - by, az - bz)
  return 2 * Math.asin(Math.min(1, chord / 2)) * MARS_MEAN_RADIUS_KM
}

function unitVector(c: MarsCoordinate): [number, number, number] {
  const lat = toRadians(c.latitude)
  const lon = toRadians(c.longitudeEast)
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}
