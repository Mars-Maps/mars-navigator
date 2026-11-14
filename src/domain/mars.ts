import type { Classified, DataClassification } from './classification'

/**
 * IAU mean radius of Mars, in kilometres. Used to convert angular distance on
 * the surface into kilometres. A published constant, not measured by us.
 */
export const MARS_MEAN_RADIUS_KM = 3389.5

/**
 * A position on the Mars surface.
 *
 * Longitude is degrees EAST in the range 0–360, which is the usual convention
 * for Mars and differs from Earth's ±180. The sources use ±180°
 * (Trek, USGS) or −360 to +360 (rover feeds), and each adapter converts into this convention and says so.
 * Latitude is planetocentric.
 */
export interface MarsCoordinate {
  /** Degrees north, −90 to 90. */
  latitude: number
  /** Degrees east, 0 to 360. */
  longitudeEast: number
}

/** A known place on the surface: a route vertex, a marked point, a stop. */
export interface SurfacePoint {
  id: string
  coordinate: MarsCoordinate
  /** Elevation is frequently missing in real datasets — hence Classified. */
  elevationMeters: Classified<number>
  label?: string
}

/** A point along a route. Same shape as any other surface point. */
export type RoutePoint = SurfacePoint

export interface ExplorationRoute {
  id: string
  name: string
  /** Provenance of the route as a whole. */
  classification: DataClassification
  points: RoutePoint[]
}

export interface MarsDataset {
  id: string
  name: string
  /** Where this came from — a file, an API, or an explicit simulation note. */
  source: string
  /** True when nothing in this dataset is real. Drives the UI warning. */
  isSimulated: boolean
  routes: ExplorationRoute[]
}

/**
 * The one way a coordinate is written for people: "12.3°N 243.6°E". South
 * is a suffix, not a sign, and longitude keeps the 0–360°E convention above
 * so copied values round-trip through adapters unchanged. The coordinate
 * utilities extend this; do not add a second format elsewhere.
 */
export function formatMarsCoordinate(
  c: MarsCoordinate,
  decimals = 1,
): string {
  // Round first, then decide hemisphere and wrap, so 359.96 prints as 0.0°E
  // (never 360.0°E, which no adapter accepts) and −0.04 prints as 0.0°N.
  const lat = Number(c.latitude.toFixed(decimals))
  const lon = Number(c.longitudeEast.toFixed(decimals)) % 360
  const hemisphere = lat < 0 ? 'S' : 'N'
  return `${Math.abs(lat).toFixed(decimals)}°${hemisphere} ${lon.toFixed(decimals)}°E`
}

/** Why a coordinate was rejected, so the UI can say which part to fix. */
export type CoordinateRejection = 'format' | 'latitude-range' | 'longitude-range'

export type CoordinateParse =
  | { ok: true; coordinate: MarsCoordinate }
  | { ok: false; reason: CoordinateRejection }

export type CoordinateCheck = { ok: true } | { ok: false; reason: CoordinateRejection }

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/
/** The form formatMarsCoordinate writes, with any spacing: "12.3°S 243.6°E". */
const LABELLED = /^(\d+(?:\.\d+)?)\s*°\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*°\s*E$/i

/**
 * The inverse of formatMarsCoordinate, so a copied coordinate pastes back
 * anywhere a coordinate is typed. Accepts that labelled form and plain
 * decimal "lat, lon" (also space-separated). Strict: no exponents, no ±180
 * longitudes, nothing clamped or wrapped. A dataset's own convention is
 * converted by its adapter, never here.
 */
export function parseMarsCoordinate(text: string): CoordinateParse {
  // U+2212 is the typographic minus, common in copied text.
  const s = text.trim().replace(/−/g, '-')
  let latitude: number
  let longitudeEast: number

  const labelled = LABELLED.exec(s)
  if (labelled) {
    const south = labelled[2].toUpperCase() === 'S'
    latitude = Number(labelled[1]) * (south ? -1 : 1)
    longitudeEast = Number(labelled[3])
  } else {
    const parts = s.split(/\s*[,\s]\s*/)
    if (parts.length !== 2 || !parts.every((p) => DECIMAL.test(p))) {
      return { ok: false, reason: 'format' }
    }
    latitude = Number(parts[0])
    longitudeEast = Number(parts[1])
  }

  const coordinate = { latitude, longitudeEast }
  // The domain check has the final word, so the two cannot drift apart.
  const check = validateCoordinate(coordinate)
  return check.ok ? { ok: true, coordinate } : check
}

/**
 * The range rules for MarsCoordinate, with the reason when one fails:
 * latitude −90..90 inclusive (the poles are valid), longitude 0 ≤ lon < 360
 * east (360 is 0 and must already be wrapped). Non-finite
 * numbers are 'format'. Nothing is clamped or wrapped here.
 */
export function validateCoordinate(c: MarsCoordinate): CoordinateCheck {
  if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitudeEast)) {
    return { ok: false, reason: 'format' }
  }
  if (c.latitude < -90 || c.latitude > 90) return { ok: false, reason: 'latitude-range' }
  if (c.longitudeEast < 0 || c.longitudeEast >= 360) {
    return { ok: false, reason: 'longitude-range' }
  }
  return { ok: true }
}

/** Basic sanity checks. Adapters call this; nothing downstream should need to. */
export function isValidCoordinate(c: MarsCoordinate): boolean {
  return validateCoordinate(c).ok
}
