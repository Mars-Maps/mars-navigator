import { isAvailable, type Classified, type MarsCoordinate, type RoverTraverse, type SurfaceImage } from '../domain'
import type { RawImageBatch, SolRange } from '../data/adapters/RawImagesAdapter'
import { TRAVERSE_LOADING_REASON } from '../features/mars-3d/traverseLabel'
import { formatDistanceM, PHOTOS_NOT_PLACED_REASON, STOP_CARD_PHOTOS } from '../features/mission-ui/stops/stopCardMath'
import { photosNear, positionImages, type PhotoNearby } from '../features/route-analysis/photoPositions'
import { surfaceDistanceKm } from '../features/route-analysis/routeDistance'

/**
 * Which rover photos the stop card shows.
 *
 * A photo is placed only at a waypoint of the rover's path, so the
 * photos near a stop are those taken at the waypoints near it, and those
 * were taken on the sols the rover stood there: from the sol it arrived to
 * the sol it next stopped. The landing site alone has about 30 waypoints
 * over sols 13–380 and 24,000 images in sols 13–110, so the card does not
 * read them all. It reads one camera, nearest waypoint first, a few pages
 * each, until it has the photos it shows, and claims no count and no "none"
 * it did not read: a span cut short is said so.
 */

/** The rover's left navigation camera: one eye of the stereo pair, for what the ground looks like. A project choice. */
export const STOP_PHOTO_CAMERAS: readonly string[] = ['NAVCAM_LEFT']

/** How many waypoints near a stop the card reads before it stops looking: a project choice. With up to three pages each (`useStopPhotos`), a stop is at most nine requests. */
export const STOP_PHOTO_WAYPOINTS = 3

/** Said when no waypoint is in reach: a photo is only ever placed at one, so none can be placed near the stop. */
export function noWaypointNearText(radiusM: number): string {
  return `No rover waypoint within ${formatDistanceM(radiusM)}, so no rover photo can be placed near this stop`
}

/** Said while the photos are read. */
export const STOP_PHOTOS_READING = 'Reading the rover photos taken near this stop'

/** One waypoint near the stop, and the sols its photos can be from. */
export interface WaypointSols {
  distanceM: number
  fromSol: number
  toSol: number
}

/**
 * The waypoints within `radiusM` of `point`, nearest first, each with the
 * sols the rover stood there: to the next waypoint's sol, or its own for
 * the last one. Two waypoints on the same sols are read once.
 */
export function waypointSolsNear(traverse: RoverTraverse, point: MarsCoordinate, radiusM: number): WaypointSols[] {
  const near: WaypointSols[] = []
  const { points } = traverse
  for (let i = 0; i < points.length; i++) {
    const distanceM = surfaceDistanceKm(point, points[i].coordinate) * 1000
    if (!(distanceM <= radiusM)) continue
    near.push({ distanceM, fromSol: points[i].sol, toSol: points[i + 1]?.sol ?? points[i].sol })
  }
  near.sort((a, b) => a.distanceM - b.distanceM)
  const seen = new Set<string>()
  return near.filter((w) => {
    const key = `${w.fromSol}-${w.toSol}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** What the card is given: the photos, or null with why no search answered. */
export type StopPhotos = { photos: PhotoNearby[] } | { photos: null; reason: string }

export type ReadRawImages = (range: SolRange, signal: AbortSignal) => Promise<Classified<RawImageBatch>>

/**
 * The photos for the card at `point`. Never more than the card shows, so
 * its "N more" line never counts photos that were not read. Never an empty
 * list, which the card reads as "No rover photos within 250 m": no waypoint
 * in reach is said as that, and finding none in what was read says what
 * was not read.
 */
export async function findStopPhotos(
  point: MarsCoordinate,
  traverse: RoverTraverse,
  radiusM: number,
  read: ReadRawImages,
  signal: AbortSignal,
): Promise<StopPhotos> {
  const waypoints = waypointSolsNear(traverse, point, radiusM)
  if (waypoints.length === 0) return { photos: null, reason: noWaypointNearText(radiusM) }
  const images = new Map<string, SurfaceImage>()
  let found: PhotoNearby[] = []
  let cutShort = 0
  const tried = waypoints.slice(0, STOP_PHOTO_WAYPOINTS)
  for (const w of tried) {
    const batch = await read({ fromSol: w.fromSol, toSol: w.toSol, cameras: STOP_PHOTO_CAMERAS }, signal)
    if (!isAvailable(batch)) return { photos: null, reason: batch.reason }
    // Newest first: a span cut short kept its last sols and lost the arrival, when the photos at the waypoint are taken.
    if (batch.value.truncated || batch.value.ranDry) cutShort++
    for (const image of batch.value.images) images.set(image.id, image)
    found = photosNear(positionImages([...images.values()], [traverse]), point, radiusM)
    if (found.filter((p) => !p.approximate).length >= STOP_CARD_PHOTOS) break
  }
  if (found.length > 0) return { photos: preferPlaced(found).slice(0, STOP_CARD_PHOTOS) }
  return { photos: null, reason: noneFoundText(tried.length, waypoints.length - tried.length, cutShort) }
}

/** `findStopPhotos`, never rejecting: a throw anywhere in the search says so on the card instead of leaving it reading. */
export function searchStopPhotos(...args: Parameters<typeof findStopPhotos>): Promise<StopPhotos> {
  return findStopPhotos(...args).catch((e: unknown) => ({
    photos: null,
    reason: `The rover photos could not be placed: ${e instanceof Error ? e.message : String(e)}`,
  }))
}

/** "No NAVCAM_LEFT photos were found at the 3 nearest rover waypoints. Not searched: other cameras, 2 farther waypoints." */
export function noneFoundText(read: number, notRead: number, cutShort: number): string {
  const notSearched = ['other cameras']
  if (notRead > 0) notSearched.push(`${notRead} farther ${notRead === 1 ? 'waypoint' : 'waypoints'}`)
  if (cutShort > 0) notSearched.push(`older photos at ${cutShort} of these waypoints`)
  const at = read === 1 ? 'the nearest rover waypoint' : `the ${read} nearest rover waypoints`
  return `No ${STOP_PHOTO_CAMERAS.join(', ')} photos were found at ${at}. Not searched: ${notSearched.join(', ')}.`
}

/**
 * Photos taken at a waypoint before those placed at the last one the rover
 * passed ("Approximate position", taken mid-drive), each group nearest first.
 * At the sample walk's start every photo 6 m away is mid-drive; 13 are at a
 * waypoint 12 m away. The card then orders what it is given by distance.
 */
function preferPlaced(photos: readonly PhotoNearby[]): PhotoNearby[] {
  return [...photos.filter((p) => !p.approximate), ...photos.filter((p) => p.approximate)]
}

/**
 * What the card shows for the rover's path and the search's answer so far.
 * The path still loading reads as the photos being read; a path that failed
 * gives `PHOTOS_NOT_PLACED_REASON`, as nothing can be placed.
 */
export function photosForCard(traverse: Classified<RoverTraverse>, answer: StopPhotos | null): StopPhotos {
  if (!isAvailable(traverse)) {
    return { photos: null, reason: traverse.reason === TRAVERSE_LOADING_REASON ? STOP_PHOTOS_READING : PHOTOS_NOT_PLACED_REASON }
  }
  return answer ?? { photos: null, reason: STOP_PHOTOS_READING }
}
