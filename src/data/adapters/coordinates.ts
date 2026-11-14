import { validateCoordinate, type CoordinateParse } from '../../domain'

/**
 * How a source dataset writes longitude. The project stores degrees EAST
 * 0–360 (src/domain/mars.ts).
 * Each adapter names its source's convention
 * and converts here, so the conversion lives in one place.
 *
 * - `east-360`: 0..360, east-positive. The project convention.
 * - `east-180`: −180..180, east-positive. Earth-style.
 * - `west-360`: 0..360, west-positive. Older planetographic Mars products
 *   and Mars24's subsolar longitude.
 * - `east-signed-360`: −360..360, east-positive. The rover waypoint feeds
 *   (Mars 2020 PLACES SIS p.29).
 *
 * Latitude is taken as-is (planetocentric, −90..90). If a dataset
 * turns out to be planetographic, that conversion goes here too.
 */
export type LongitudeConvention = 'east-360' | 'east-180' | 'west-360' | 'east-signed-360'

/**
 * A source longitude → degrees east 0 ≤ lon < 360, or null when it is not
 * finite or outside its convention's range. Out-of-range values are
 * rejected, never wrapped: 200 in a ±180 dataset is an error in the data,
 * not a longitude. The closed grid edge (360, or −180 / 180) is accepted and
 * becomes 0 / 180, which is the same meridian.
 */
export function toLongitudeEast(
  lon: number,
  from: LongitudeConvention,
): number | null {
  if (!Number.isFinite(lon)) return null
  switch (from) {
    case 'east-360':
      return lon >= 0 && lon <= 360 ? lon % 360 : null
    case 'east-180':
      if (lon < -180 || lon > 180) return null
      return lon < 0 ? lon + 360 : lon
    case 'west-360':
      if (lon < 0 || lon > 360) return null
      // 0 − 0 is −0 in floating point; + 0 normalises it.
      return ((360 - lon) % 360) + 0
    case 'east-signed-360': {
      if (lon < -360 || lon > 360) return null
      const east = lon % 360
      return east < 0 ? east + 360 : east + 0
    }
  }
}

/**
 * A source latitude/longitude pair → MarsCoordinate, with the same result
 * shape as parseMarsCoordinate so adapters report the failing part.
 */
export function toMarsCoordinate(
  latitude: number,
  longitude: number,
  from: LongitudeConvention,
): CoordinateParse {
  const longitudeEast = toLongitudeEast(longitude, from)
  if (longitudeEast === null) {
    return { ok: false, reason: Number.isFinite(longitude) ? 'longitude-range' : 'format' }
  }
  const coordinate = { latitude, longitudeEast }
  const check = validateCoordinate(coordinate)
  return check.ok ? { ok: true, coordinate } : check
}
