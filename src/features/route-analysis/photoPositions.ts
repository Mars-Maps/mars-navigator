import {
  derived,
  isAvailable,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type RoverMotionCounter,
  type RoverTraverse,
  type SurfaceImage,
  type TraversePoint,
} from '../../domain'
import { surfaceDistanceKm } from './routeDistance'

/**
 * Photo positions: the raw-image feed gives each photo the rover's
 * motion counter (site/drive) but no coordinate, so the photo is placed by
 * joining that counter to the published traverse.
 *
 * - The traverse has a point with the same site and drive: the photo was
 *   taken there. DERIVED, the join stated.
 * - No such point, but an earlier drive on the same site: the photo is
 *   placed at the nearest earlier one, and the method starts
 *   "Approximate position", since the rover may have moved on since.
 * - Otherwise UNAVAILABLE, with the reason.
 */

/** How an approximate position's method starts, so the UI can mark it. */
export const APPROXIMATE_POSITION = 'Approximate position'

/** A photo's position from the traverse. Exported for the tests; `positionImages` is what callers use. */
export function positionFromTraverse(
  rmc: Classified<RoverMotionCounter>,
  index: TraverseIndex,
): Classified<MarsCoordinate> {
  if (!isAvailable(rmc)) return unavailable(`No site/drive for this photo: ${rmc.reason}`)
  const { site, drive } = rmc.value
  const drives = index.bySite.get(site)
  if (drives === undefined) {
    return unavailable(`The ${index.rover} traverse has no waypoint on site ${site}, so this photo cannot be placed`)
  }
  // `drives` is sorted by drive: find the last one at or before the photo's.
  let lo = 0
  let hi = drives.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (drives[mid].rmc.drive <= drive) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (found === -1) {
    return unavailable(
      `The ${index.rover} traverse has no waypoint on site ${site} at or before drive ${drive}, so this photo cannot be placed`,
    )
  }
  // Among waypoints with the same drive, the first published one.
  while (found > 0 && drives[found - 1].rmc.drive === drives[found].rmc.drive) found--
  const p = drives[found]
  if (p.rmc.drive === drive) {
    return derived(
      p.coordinate,
      `Joined by site ${site}, drive ${drive} to the ${index.rover} traverse waypoint with the same site and drive (sol ${p.sol}); ${index.source}`,
    )
  }
  return derived(
    p.coordinate,
    `${APPROXIMATE_POSITION}: the traverse has no waypoint at site ${site}, drive ${drive}; placed at the nearest earlier one, drive ${p.rmc.drive} (sol ${p.sol}). The rover may have moved on before the photo was taken. ${index.source}`,
  )
}

/** The traverse's waypoints by site, each list sorted by drive. */
export interface TraverseIndex {
  rover: string
  source: string
  bySite: Map<number, TraversePoint[]>
}

export function indexTraverse(traverse: RoverTraverse): TraverseIndex {
  const bySite = new Map<number, TraversePoint[]>()
  for (const p of traverse.points) {
    const list = bySite.get(p.rmc.site)
    if (list) list.push(p)
    else bySite.set(p.rmc.site, [p])
  }
  // A stable sort keeps the first published waypoint first among equal drives.
  for (const list of bySite.values()) list.sort((a, b) => a.rmc.drive - b.rmc.drive)
  return { rover: traverse.rover, source: `traverse: ${traverse.source}`, bySite }
}

/**
 * Each photo with its position from its own rover's traverse. A photo
 * whose rover has no traverse here is UNAVAILABLE, never placed on the
 * other rover's path.
 */
export function positionImages(images: readonly SurfaceImage[], traverses: readonly RoverTraverse[]): SurfaceImage[] {
  const indexes = new Map(traverses.map((t) => [t.rover, indexTraverse(t)]))
  return images.map((image) => {
    const index = indexes.get(image.rover)
    const position =
      index === undefined
        ? unavailable<MarsCoordinate>(`No ${image.rover} traverse was read, so this photo cannot be placed`)
        : positionFromTraverse(image.rmc, index)
    return { ...image, position }
  })
}

/** True when the position is the nearest earlier waypoint, not the photo's own. */
export function isApproximatePosition(position: Classified<MarsCoordinate>): boolean {
  return position.classification === 'DERIVED' && position.method.startsWith(APPROXIMATE_POSITION)
}

/** A photo near a point, and how far from it. */
export interface PhotoNearby {
  image: SurfaceImage
  /** Great-circle distance from the point to the photo's position, metres: DERIVED, with how the photo was placed. */
  distanceM: Classified<number>
  /** True when the position is the nearest earlier waypoint, not the photo's own. */
  approximate: boolean
}

/**
 * The photos within `radiusM` of `point`, nearest first. Only placed
 * photos count: an UNAVAILABLE position is never near anything.
 */
export function photosNear(images: readonly SurfaceImage[], point: MarsCoordinate, radiusM: number): PhotoNearby[] {
  const near: (PhotoNearby & { km: number })[] = []
  for (const image of images) {
    const p = image.position
    if (!isAvailable(p)) continue
    const km = surfaceDistanceKm(point, p.value)
    if (km * 1000 > radiusM) continue
    near.push({
      image,
      km,
      distanceM: derived(km * 1000, `Great-circle distance from the point to the photo's position. ${p.classification === 'DERIVED' ? p.method : ''}`),
      approximate: isApproximatePosition(p),
    })
  }
  return near.sort((a, b) => a.km - b.km).map(({ km: _km, ...photo }) => photo)
}
