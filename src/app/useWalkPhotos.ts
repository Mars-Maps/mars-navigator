import { useEffect, useMemo, useState } from 'react'
import { isAvailable, type Classified, type RoverTraverse, type SurfaceImage, type WalkPlan, type WalkStop } from '../domain'
import { TRAVERSE_LOADING_REASON } from '../features/mars-3d/traverseLabel'
import {
  PHOTOS_NEED_A_WALK,
  STOP_PHOTO_RADIUS_M,
  WALK_PHOTOS_NOT_PLACED_REASON,
  WALK_PHOTOS_READING,
} from '../features/mission-ui/photos/photoStripMath'
import { useWalkPlan } from '../state'
import { formatDistanceM, STOP_CARD_PHOTOS } from '../features/mission-ui/stops/stopCardMath'
import { searchStopPhotos, STOP_PHOTO_CAMERAS, type ReadRawImages, type StopPhotos } from './stopPhotos'
import { useRoverTraverse } from './useRoverTraverse'
import { readShared } from './useStopPhotos'

/**
 * The photo strip's photos: the stop card's search run at
 * every stop of the walk, through the same shared reads, so the strip asks
 * the feed for nothing new and a stop's photos are those its card shows.
 * A stop's filter in the strip may also show a photo another stop's search
 * found within its radius, which its card does not.
 */

/**
 * What the strip's photos are, under its title: the search's own limits,
 * so its count is never read as every photo taken near the stops. The cap
 * is per search, not per filter: a "Near Stop n" filter also shows photos
 * another stop's search found within the radius, so it can hold more.
 */
export function walkPhotosScope(
  perStop: number = STOP_CARD_PHOTOS,
  cameras: readonly string[] = STOP_PHOTO_CAMERAS,
  radiusM: number = STOP_PHOTO_RADIUS_M,
): string {
  return (
    `Up to ${perStop} ${cameras.join(', ')} photos found per stop, from its nearest rover waypoints; ` +
    `a stop's filter also shows those another stop found within ${formatDistanceM(radiusM)} of this stop. Not every photo taken there`
  )
}

/** What the Rover photos panel is given. */
export interface WalkPhotos {
  /** Every photo found near a stop, once each; null while there are none to show yet, with `reason`. */
  images: SurfaceImage[] | null
  /** Why `images` is null. */
  reason?: string
  /** By stop index: the stop's search's reason when it gave no photos, else null. */
  stopReasons: (string | null)[]
}

/** Each stop's answer in walking order, one stop at a time, so a stop's reads are shared with the next. */
export async function searchWalkPhotos(
  stops: readonly Pick<WalkStop, 'coordinate'>[],
  traverse: RoverTraverse,
  radiusM: number,
  read: ReadRawImages,
  signal: AbortSignal,
): Promise<StopPhotos[]> {
  const answers: StopPhotos[] = []
  for (const stop of stops) {
    if (signal.aborted) break
    answers.push(await searchStopPhotos(stop.coordinate, traverse, radiusM, read, signal))
  }
  return answers
}

/**
 * The panel's props from the plan, the rover's path and the stops' answers.
 * Nothing is shown until every stop has answered, so the All stops view
 * never counts a search still running as finding nothing.
 */
export function walkPhotosFrom(
  hasPlan: boolean,
  traverse: Classified<RoverTraverse>,
  answers: readonly StopPhotos[] | null,
): WalkPhotos {
  if (!hasPlan) return { images: null, reason: PHOTOS_NEED_A_WALK, stopReasons: [] }
  if (!isAvailable(traverse)) {
    const reason = traverse.reason === TRAVERSE_LOADING_REASON ? WALK_PHOTOS_READING : WALK_PHOTOS_NOT_PLACED_REASON
    return { images: null, reason, stopReasons: [] }
  }
  if (answers === null) return { images: null, reason: WALK_PHOTOS_READING, stopReasons: [] }
  const images = new Map<string, SurfaceImage>()
  for (const answer of answers) for (const p of answer.photos ?? []) images.set(p.image.id, p.image)
  return { images: [...images.values()], stopReasons: answers.map((a) => (a.photos === null ? a.reason : null)) }
}

/** The stops' answers as the hook stores them: with the plan and radius they were searched for. */
export interface WalkPhotosAnswer {
  plan: WalkPlan
  radiusM: number
  answers: StopPhotos[]
}

/**
 * The stored answers if they are this plan's at this radius, else null
 * (still reading). An answer for another plan or radius is not this one's,
 * even for the render between a new plan and its search's first write.
 */
export function answersFor(answer: WalkPhotosAnswer | null, plan: WalkPlan | null, radiusM: number): StopPhotos[] | null {
  return answer !== null && answer.plan === plan && answer.radiusM === radiusM ? answer.answers : null
}

/** The walk's photos for the strip. A search left behind by a new plan writes nothing. */
export function useWalkPhotos(radiusM: number): WalkPhotos {
  const plan = useWalkPlan((s) => s.plan)
  const traverse = useRoverTraverse('perseverance')
  const [answer, setAnswer] = useState<WalkPhotosAnswer | null>(null)
  useEffect(() => {
    if (plan === null || !isAvailable(traverse)) return
    const controller = new AbortController()
    void searchWalkPhotos(plan.stops, traverse.value, radiusM, readShared, controller.signal).then((answers) => {
      if (!controller.signal.aborted) setAnswer({ plan, radiusM, answers })
    })
    return () => controller.abort()
  }, [plan, traverse, radiusM])
  const answers = answersFor(answer, plan, radiusM)
  return useMemo(() => walkPhotosFrom(plan !== null, traverse, answers), [plan, traverse, answers])
}
