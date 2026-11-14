import { isAvailable, type SurfaceImage, type WalkStop } from '../../../domain'
import { isApproximatePosition, photosNear, type PhotoNearby } from '../../route-analysis/photoPositions'

/**
 * The photo strip's maths: which rover photos to show, in what
 * order, and how many at a time. Pure, so the strip only lays them out.
 */

/**
 * One rover photo along the path: `PhotoNearby` without the distance,
 * which only a stop has. Where it was taken is `image.position`; `approximate`
 * is set when the join used the nearest earlier waypoint. A stop's
 * `photosNear` output is already one of these.
 */
export type PathPhoto = Pick<PhotoNearby, 'image' | 'approximate'>

/**
 * The whole path's photos from the `positionImages` output, each marked
 * approximate by the join's own test. A photo the join could not place is
 * kept, not approximate: the strip says it has no known position.
 */
export function pathPhotos(images: readonly SurfaceImage[]): PathPhoto[] {
  return images.map((image) => ({ image, approximate: isApproximatePosition(image.position) }))
}

/**
 * Each stop of the walk, in walking order, with the photos within `radiusM`
 * of it (`photosNear`): the strip's "Near Stop n" filters. A stop
 * whose search gave no photos keeps the search's reason (`reasons`, by stop
 * index), so the strip never says "none within" a search that did not look.
 */
export function stopPhotos(
  stops: readonly Pick<WalkStop, 'label' | 'coordinate'>[],
  images: readonly SurfaceImage[],
  radiusM: number,
  reasons: readonly (string | null)[] = [],
): { label: string; photos: PathPhoto[]; reason?: string }[] {
  return stops.map((s, i) => {
    const photos = photosNear(images, s.coordinate, radiusM)
    const reason = reasons[i]
    return photos.length === 0 && typeof reason === 'string' ? { label: s.label, photos, reason } : { label: s.label, photos }
  })
}

/** Shown before a walk is planned: the strip's photos are the ones near the walk's stops. */
export const PHOTOS_NEED_A_WALK = 'Plan a walk to see the rover photos taken near its stops'

/** Shown while the rover's path or the photos near the stops are read. */
export const WALK_PHOTOS_READING = "Reading the rover photos taken near the walk's stops"

/** Shown when the rover's path could not be read: a photo is placed only by joining it to the path. */
export const WALK_PHOTOS_NOT_PLACED_REASON = "The rover's path has not been read, so no photo could be placed near the walk's stops"

/** The All stops view with no photos, when the stops' searches said why: each stop's reason is listed under it. */
export const NO_PHOTOS_NEAR_STOPS = "No rover photos were found near the walk's stops."

/**
 * How far from a stop the strip and the stop card look for photos, metres:
 * a project choice, wide enough for the sample walk's Stop 2 (227 m from a
 * waypoint). One constant, read by both (`SurfaceWalkPanels.tsx`), so the
 * two never disagree on which photos are "near" a stop.
 */
export const STOP_PHOTO_RADIUS_M = 250

/** Shown while the shell has no photos to hand the strip, so an empty strip is never read as "no photos". */
export const PHOTOS_NOT_LOADED_REASON = 'Rover photos have not been loaded, so none can be shown yet'

/** Thumbnails per page: a long path never puts thousands of images in the page at once. */
export const STRIP_PAGE = 40

/**
 * Oldest sol first, then by the time taken where known (unknown last), then
 * by NASA's id, so the order never changes between renders. A photo that
 * appears twice (overlapping feed pages) is shown once.
 */
export function bySol(photos: readonly PathPhoto[]): PathPhoto[] {
  const seen = new Set<string>()
  const unique = photos.filter((p) => {
    if (seen.has(p.image.id)) return false
    seen.add(p.image.id)
    return true
  })
  return unique.sort(
    (a, b) => a.image.sol - b.image.sol || takenMs(a) - takenMs(b) || (a.image.id < b.image.id ? -1 : a.image.id > b.image.id ? 1 : 0),
  )
}

function takenMs(p: PathPhoto): number {
  const t = p.image.takenUtcMs
  return isAvailable(t) && Number.isFinite(t.value) ? t.value : Number.POSITIVE_INFINITY
}

/** The first `count` photos, and how many remain after them. */
export function page<T>(items: readonly T[], count: number): { shown: T[]; remaining: number } {
  const n = Math.max(0, Math.floor(count))
  return { shown: items.slice(0, n), remaining: Math.max(0, items.length - n) }
}

/** "Showing 40 of 312" or "312 photos", in sol order. */
export function countText(shown: number, total: number): string {
  if (shown >= total) return `${total} ${total === 1 ? 'photo' : 'photos'}, oldest sol first`
  return `Showing ${shown} of ${total}, oldest sol first`
}
