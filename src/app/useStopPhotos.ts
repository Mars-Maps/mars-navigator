import { useEffect, useState } from 'react'
import { isAvailable, type Classified, type MarsCoordinate } from '../domain'
import { loadRawImages, type RawImageBatch, type SolRange } from '../data/adapters/RawImagesAdapter'
import { shareRead } from './roverFeed'
import { photosForCard, searchStopPhotos, type StopPhotos } from './stopPhotos'
import { useRoverTraverse } from './useRoverTraverse'

/**
 * Up to three pages of a hundred per waypoint: a 13-sol stay near the sample
 * walk's start (sols 72–84) holds 244 Navcam-left photos. A span still cut short is
 * said so by `findStopPhotos`.
 */
const PAGES_PER_WAYPOINT = 3

/** One entry per sol span and camera visited, kept for the page's life: bounded by the path's waypoints. */
const reads = new Map<string, (signal: AbortSignal) => Promise<Classified<RawImageBatch>>>()

/** One read per sol span and camera for the page's life, shared by every stop that asks (`shareRead`), the photo strip's too. */
export function readShared(range: SolRange, signal: AbortSignal): Promise<Classified<RawImageBatch>> {
  const key = `${range.fromSol}-${range.toSol}-${range.cameras?.join('|') ?? '*'}`
  let read = reads.get(key)
  if (read === undefined) {
    read = shareRead((s) => loadRawImages(range, s, undefined, PAGES_PER_WAYPOINT))
    reads.set(key, read)
  }
  return read(signal)
}

/**
 * Rover photos near `point` for the stop card: Perseverance's path,
 * then the photos at the waypoints near the point. A search left behind by
 * a new stop writes nothing.
 */
export function useStopPhotos(point: MarsCoordinate | null, radiusM: number): StopPhotos {
  const traverse = useRoverTraverse('perseverance')
  const [answer, setAnswer] = useState<{ point: MarsCoordinate; photos: StopPhotos } | null>(null)
  useEffect(() => {
    if (point === null || !isAvailable(traverse)) return
    const controller = new AbortController()
    void searchStopPhotos(point, traverse.value, radiusM, readShared, controller.signal).then((photos) => {
      if (!controller.signal.aborted) setAnswer({ point, photos })
    })
    return () => controller.abort()
  }, [point, traverse, radiusM])
  // An answer for another stop is not this stop's.
  return photosForCard(traverse, answer !== null && answer.point === point ? answer.photos : null)
}
