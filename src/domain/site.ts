import type { GeologicMap } from './geology'
import { isValidCoordinate, type MarsCoordinate } from './mars'

/**
 * The Marswalk site the app is about. One definition
 * carries everything a view needs to open on it, so a second site is one
 * more entry in the data layer's site list and no code elsewhere.
 */

/**
 * A box on the surface, degrees, longitude 0–360°E, west < east, south <
 * north. A box that crosses 0°E cannot be written this way; no site needs
 * one yet, and `siteProblem` rejects the attempt rather than wrapping.
 */
export interface SiteBounds {
  west: number
  east: number
  south: number
  north: number
}

export interface MissionSite {
  id: string
  /** As the UI names it, e.g. "Jezero crater". */
  name: string
  /** One line for the intro: what a walk there is for. */
  mission: string
  /** Where the camera flies to. */
  centre: MarsCoordinate
  /** What the camera frames: the site's published map sheet. */
  bounds: SiteBounds
  /** The geologic map that covers the site, with its citation. */
  map: GeologicMap
  /** Where `centre` and `bounds` come from, and how the centre was taken from it. */
  source: string
}

/** Why `site` breaks the contract above, or null when it keeps it. */
export function siteProblem(site: MissionSite): string | null {
  const b = site.bounds
  if (![b.west, b.east, b.south, b.north].every(Number.isFinite)) return 'bounds are not finite'
  if (b.west < 0 || b.east > 360 || b.west >= b.east) return 'bounds must run west < east within 0–360°E'
  if (b.south < -90 || b.north > 90 || b.south >= b.north) return 'bounds must run south < north within ±90°'
  if (!isValidCoordinate(site.centre)) return 'centre is not a valid coordinate'
  if (!insideBounds(site.centre, b)) return 'centre is outside the bounds'
  if (site.name.trim() === '' || site.source.trim() === '') return 'name and source must be stated'
  return null
}

export function insideBounds(c: MarsCoordinate, b: SiteBounds): boolean {
  return c.longitudeEast >= b.west && c.longitudeEast <= b.east && c.latitude >= b.south && c.latitude <= b.north
}

/**
 * The larger of the box's two sides as an angle at the planet's centre,
 * degrees: the east–west side shrinks with the cosine of the middle
 * latitude. What a camera has to fit to show the whole site.
 */
export function boundsSpanDeg(b: SiteBounds): number {
  const midLat = ((b.south + b.north) / 2) * (Math.PI / 180)
  return Math.max(b.north - b.south, (b.east - b.west) * Math.cos(midLat))
}
