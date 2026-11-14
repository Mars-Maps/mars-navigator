import type { GeologicUnitArea, MarsCoordinate } from '../../domain'

/**
 * Which mapped unit covers a point, in plain arithmetic on the
 * map's own rings. Kept apart from geologyGeometry, which needs Three.js,
 * so the shell's caption can ask without pulling the renderer into the
 * first load.
 */

/**
 * Longitudes of a ring, unwrapped so no step jumps across 0°/360°E: each
 * is moved by ±360 to lie within 180° of the previous one. Unit polygons
 * are small (one site), so this is enough to keep them planar.
 */
export function unwrappedLongitudes(ring: MarsCoordinate[], reference: number): number[] {
  const out: number[] = []
  let previous = reference
  for (const c of ring) {
    let lon = c.longitudeEast
    while (lon - previous > 180) lon -= 360
    while (lon - previous < -180) lon += 360
    out.push(lon)
    previous = lon
  }
  return out
}

/** A ring without its closing vertex, if the source repeated the first. */
export function openRing(ring: MarsCoordinate[]): MarsCoordinate[] {
  if (ring.length < 2) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  const closed = first.latitude === last.latitude && first.longitudeEast === last.longitudeEast
  return closed ? ring.slice(0, -1) : ring
}

/** Even-odd ray test of one ring, longitudes unwrapped around `lon`. */
function ringContains(ring: MarsCoordinate[], lat: number, lon: number): boolean {
  const lons = unwrappedLongitudes(ring, lon)
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].latitude
    const yj = ring[j].latitude
    if (yi > lat !== yj > lat) {
      const x = lons[j] + ((lat - yj) / (yi - yj)) * (lons[i] - lons[j])
      if (lon < x) inside = !inside
    }
  }
  return inside
}

/** True when `c` is inside the area's outer ring and outside its holes. */
export function areaContains(area: GeologicUnitArea, c: MarsCoordinate): boolean {
  const [outer, ...holes] = area.rings.map(openRing)
  if (!outer || outer.length < 3) return false
  if (!ringContains(outer, c.latitude, c.longitudeEast)) return false
  return !holes.some((h) => h.length >= 3 && ringContains(h, c.latitude, c.longitudeEast))
}

/**
 * The area under `c`, or null where no mapped unit covers it. Null is the
 * caller's UNAVAILABLE, never an empty or guessed unit.
 */
export function areaAt(areas: readonly GeologicUnitArea[], c: MarsCoordinate): GeologicUnitArea | null {
  return areas.find((a) => areaContains(a, c)) ?? null
}
