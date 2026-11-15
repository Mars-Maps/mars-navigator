import { MARS_MEAN_RADIUS_KM, type GeologicUnitArea, type MarsCoordinate, type SiteBounds } from '../../domain'

/**
 * The lattice the landing rating is worked on: cell centres over a
 * box, and which of them lie inside the crater by the site's geologic map.
 * Pure: the shell reads the heights and the map's polygons and hands them in.
 */

/**
 * The units of USGS SIM 3464 that count as inside Jezero crater for the
 * landing rating: the three the map names for Jezero, and the Lower etched
 * unit, which the map reads as "Either deposited into an existing lake
 * within Jezero or subsequently altered by later lacustrine processes".
 * Spelled as the map spells them, since they are matched against what the
 * units adapter reads (`tests/fixtures/sim3464UnitNames.ts`).
 *
 * A project reading of the map, not a line the map draws: other ground
 * inside the rim (dunes, small craters and their ejecta, the smooth and
 * upper etched units) is not counted, so it is never rated green. That errs
 * to the cautious side of "green only inside the crater".
 */
export const CRATER_INTERIOR_UNITS: readonly string[] = [
  'Jezero floor unit',
  'Jezero fan 1 unit',
  'Jezero fan 2 unit',
  'Lower etched unit',
]

/** The same, for the legend, in a line. */
export const CRATER_INTERIOR_LEGEND =
  'Inside the crater: its floor, fan and Lower etched map units. Other ground inside the rim counts as outside.'

/** How the crater flag was worked out, for the rating's method. */
export const CRATER_INTERIOR_BASIS = `Inside the crater means on one of these units of the site's geologic map: ${CRATER_INTERIOR_UNITS.join(', ')}. A project reading of the map; other ground inside the rim is not counted and is never green`

export interface LandingLattice {
  cols: number
  rows: number
  /** Between columns at the box's middle latitude, and between rows, km. */
  spacingEastKm: number
  spacingNorthKm: number
  /** Cell centres as (latitude, longitude °E) pairs, rows north to south, each west to east. */
  points: Float64Array
}

/**
 * Cell centres over `bounds`, no closer than `minSpacingKm` either way: the
 * most columns and rows that keep that spacing, counted at the box's edge
 * nearer a pole, where a degree of longitude is shortest. Null for a box
 * too small for a 3 × 3 lattice, across 0/360°E, or too near a pole.
 */
export function landingLattice(bounds: SiteBounds, minSpacingKm: number): LandingLattice | null {
  const { west, east, south, north } = bounds
  if (!(east > west) || !(north > south) || !(minSpacingKm > 0)) return null
  if (Math.max(Math.abs(south), Math.abs(north)) > 85) return null
  const rad = Math.PI / 180
  const kmPerDegLat = MARS_MEAN_RADIUS_KM * rad
  const narrowest = Math.cos(Math.max(Math.abs(south), Math.abs(north)) * rad)
  const cols = Math.floor(((east - west) * kmPerDegLat * narrowest) / minSpacingKm)
  const rows = Math.floor(((north - south) * kmPerDegLat) / minSpacingKm)
  if (cols < 3 || rows < 3) return null
  const dLon = (east - west) / cols
  const dLat = (north - south) / rows
  const points = new Float64Array(cols * rows * 2)
  for (let r = 0; r < rows; r++) {
    const latitude = north - (r + 0.5) * dLat
    for (let c = 0; c < cols; c++) {
      const k = (r * cols + c) * 2
      points[k] = latitude
      points[k + 1] = west + (c + 0.5) * dLon
    }
  }
  return {
    cols,
    rows,
    spacingEastKm: dLon * kmPerDegLat * Math.cos(((south + north) / 2) * rad),
    spacingNorthKm: dLat * kmPerDegLat,
    points,
  }
}

/**
 * 1 for each lattice point inside a polygon of one of `unitNames`, else 0.
 * Even-odd over a polygon's rings, so its holes are cut out. Worked in
 * degrees, which is exact for containment away from 0/360°E and the poles,
 * where `landingLattice` gives no lattice.
 */
export function insideUnits(points: Float64Array, areas: readonly GeologicUnitArea[], unitNames: readonly string[]): Uint8Array {
  const wanted = new Set(unitNames)
  const polygons = areas
    .filter((a) => wanted.has(a.unit.name))
    .map((a) => {
      let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
      for (const ring of a.rings) {
        for (const p of ring) {
          west = Math.min(west, p.longitudeEast)
          east = Math.max(east, p.longitudeEast)
          south = Math.min(south, p.latitude)
          north = Math.max(north, p.latitude)
        }
      }
      return { rings: a.rings, west, east, south, north }
    })
  const out = new Uint8Array(points.length / 2)
  for (let k = 0; k < out.length; k++) {
    const lat = points[k * 2]
    const lon = points[k * 2 + 1]
    for (const p of polygons) {
      if (lon < p.west || lon > p.east || lat < p.south || lat > p.north) continue
      if (insideRingsDeg(lat, lon, p.rings)) {
        out[k] = 1
        break
      }
    }
  }
  return out
}

function insideRingsDeg(lat: number, lon: number, rings: readonly MarsCoordinate[][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (
        a.latitude > lat !== b.latitude > lat &&
        lon < ((b.longitudeEast - a.longitudeEast) * (lat - a.latitude)) / (b.latitude - a.latitude) + a.longitudeEast
      ) {
        inside = !inside
      }
    }
  }
  return inside
}

/** The index of the lattice cell holding `point`, or null when it is outside `bounds`. */
export function latticeCellAt(bounds: SiteBounds, cols: number, rows: number, point: MarsCoordinate): number | null {
  const u = (point.longitudeEast - bounds.west) / (bounds.east - bounds.west)
  const v = (bounds.north - point.latitude) / (bounds.north - bounds.south)
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null
  return Math.min(rows - 1, Math.floor(v * rows)) * cols + Math.min(cols - 1, Math.floor(u * cols))
}
