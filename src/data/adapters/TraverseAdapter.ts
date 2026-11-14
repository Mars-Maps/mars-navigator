import {
  official,
  unavailable,
  type Classified,
  type RoverId,
  type RoverTraverse,
  type TraversePoint,
} from '../../domain'
import { FEED_NO_DATA, TILT_SOURCE, TRAVERSE_FEEDS, type TraverseFeed } from '../traverse/traverseFeeds'
import { toMarsCoordinate } from './coordinates'
import { defaultJsonIo, type JsonIo } from './jsonIo'

/**
 * A rover's driven path from NASA's waypoint feed: every waypoint
 * with its sol, site/drive, position and height, oldest first. Position is
 * the feed's `lat`/`lon` only, never `easting`/`northing`, which Mars 2020
 * scales east by cos 18.4663° for its map projection. One malformed or
 * out-of-order waypoint makes the whole feed UNAVAILABLE with the reason:
 * a path with a silent gap would still look like the path.
 */

export type { JsonIo }

export async function loadRoverTraverse(
  rover: RoverId,
  signal: AbortSignal,
  io: JsonIo = defaultJsonIo,
  now: () => number = Date.now,
): Promise<Classified<RoverTraverse>> {
  const feed = TRAVERSE_FEEDS[rover]
  const fail = (why: string) => unavailable<RoverTraverse>(`${feed.credit} failed to load: ${why}`)
  if (signal.aborted) return fail('Cancelled')
  let body: unknown
  try {
    body = await io.fetchJson(feed.url, signal)
  } catch (error: unknown) {
    return fail(signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : String(error))
  }
  if (signal.aborted) return fail('Cancelled')
  const traverse = parseWaypoints(body, feed, now())
  return typeof traverse === 'string' ? fail(traverse) : official(traverse, `${feed.credit}, ${feed.url}`)
}

/** The feed's waypoints as a traverse, or what is wrong with them. */
export function parseWaypoints(body: unknown, feed: TraverseFeed, retrievedUtcMs: number): RoverTraverse | string {
  if (!isRecord(body) || body.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
    return 'not a GeoJSON FeatureCollection'
  }
  if (body.features.length === 0) return 'the feed lists no waypoints'
  const points: TraversePoint[] = []
  for (const [i, feature] of body.features.entries()) {
    const point = readWaypoint(feature, i, feed)
    if (typeof point === 'string') return point
    const previous = points[points.length - 1]
    if (previous !== undefined && !follows(previous, point)) {
      return `waypoint ${i} (${point.rmc.site}_${point.rmc.drive}, sol ${point.sol}) comes before the one listed above it`
    }
    points.push(point)
  }
  return { rover: feed.rover, source: feed.url, retrievedUtcMs, points }
}

function readWaypoint(feature: unknown, i: number, feed: TraverseFeed): TraversePoint | string {
  const p = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null
  if (p === null) return `waypoint ${i} has no properties`
  const { lat, lon, sol, site, drive, RMC } = p
  if (typeof lat !== 'number' || typeof lon !== 'number') return `waypoint ${i} has no numeric lat/lon`
  const position = toMarsCoordinate(lat, lon, 'east-signed-360')
  if (!position.ok) return `waypoint ${i} has a position out of range (${position.reason})`
  if (!isCount(sol)) return `waypoint ${i} has no sol`
  if (!isCount(site) || !isCount(drive)) return `waypoint ${i} has no site/drive`
  // RMC repeats site and drive as text; if the two disagree, neither is trusted.
  if (RMC !== `${site}_${drive}`) return `waypoint ${i}: RMC "${String(RMC)}" disagrees with site ${site}, drive ${drive}`
  return {
    coordinate: position.coordinate,
    sol,
    rmc: { site, drive },
    elevationMeters: measured(p.elev_geoid, feed.elevationDatum, 'height'),
    tiltDegrees: measured(p.tilt, TILT_SOURCE, 'tilt'),
  }
}

/** A feed number as OFFICIAL, or UNAVAILABLE for -9999 and for a missing value. Never 0. */
function measured(v: unknown, source: string, what: string): Classified<number> {
  if (v === FEED_NO_DATA) return unavailable(`The feed gives no ${what} for this waypoint (-9999)`)
  if (typeof v !== 'number' || !Number.isFinite(v)) return unavailable(`The feed gives no ${what} for this waypoint`)
  return official(v, source)
}

/** Oldest first: a later sol never comes before an earlier one, and site/drive only advances. */
function follows(a: TraversePoint, b: TraversePoint): boolean {
  if (b.sol < a.sol) return false
  return b.rmc.site > a.rmc.site || (b.rmc.site === a.rmc.site && b.rmc.drive > a.rmc.drive)
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
