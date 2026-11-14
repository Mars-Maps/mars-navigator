import type { SourcedHeights } from '../data/adapters/LayeredElevation'
import { official, type Classified, type MarsCoordinate, type RouteOption } from '../domain'
import {
  planProfile,
  profileFromHeights,
  profilePointPairs,
  type ElevationProfile,
  type ProfilePlan,
} from '../features/route-analysis/elevationProfile'

/**
 * What a profile needs from the elevation source: one batch read of
 * nearest-cell heights, NaN where a cell is no-data, each with the model it
 * came from, and the words for its provenance. The shell builds it
 * from the one chain in `elevation.ts`; tests pass a fake.
 */
export interface ProfileHeights {
  /** With `onFirst`, a quick answer from the fast models may come first. */
  elevationsAt(
    points: Float64Array,
    signal: AbortSignal,
    onFirst?: (first: Classified<SourcedHeights>) => void,
  ): Promise<Classified<SourcedHeights>>
  /** What a height is, for the profile's method: "nearest cell of …". */
  description: string
  /** Why a sample has no height when no model has data there. */
  noDataReason: string
  /** The cell size, km, along `path`: the finest spacing a profile of it samples at. */
  cellKmAlong(path: readonly MarsCoordinate[]): number
}

/** The profile while its heights are being read; defined beside the frame that reads it. */
export { SAMPLING_REASON } from '../features/mission-ui/navigation/ElevationProfilePanel'

/** Added to a first answer's method while the finer model is still being read. */
export const REFINING_NOTE = 'refining with the finer elevation model, still being read'

/**
 * The line of the route being navigated, or null when none is: its
 * DERIVED path when it has one, the same line the scene draws, else
 * its waypoints.
 */
export function pathOfRoute(route: RouteOption | null): MarsCoordinate[] | null {
  if (route === null) return null
  const line = route.path.classification === 'DERIVED' ? route.path.value : route.points
  return line.map((p) => p.coordinate)
}

/** Where a profile of `path` samples, never finer than the source's cells. */
export function planFor(path: readonly MarsCoordinate[], heights: ProfileHeights): Classified<ProfilePlan> {
  return planProfile(path, { minSpacingKm: heights.cellKmAlong(path) })
}

/**
 * The profile for a plan: one batch read through the elevation source, then
 * the heights paired with the plan's samples. An UNAVAILABLE plan is its
 * own answer without a read. With `onFirst`, a quick profile from the fast
 * models may come first, its method saying it is still refining.
 * Never rejects; after `signal` aborts the result is Cancelled and should
 * be ignored.
 */
export async function readProfile(
  plan: Classified<ProfilePlan>,
  heights: ProfileHeights,
  signal: AbortSignal,
  onFirst?: (first: Classified<ElevationProfile>) => void,
): Promise<Classified<ElevationProfile>> {
  if (plan.classification === 'UNAVAILABLE') return plan
  const first = onFirst
    ? (read: Classified<SourcedHeights>) => {
        const profile = toProfile(plan, read, heights)
        onFirst(profile.classification === 'DERIVED' ? { ...profile, method: `${profile.method}; ${REFINING_NOTE}` } : profile)
      }
    : undefined
  const read = await heights.elevationsAt(profilePointPairs(plan.value), signal, first)
  return toProfile(plan, read, heights)
}

/** Heights paired with the plan's samples, each naming the model it came from. */
function toProfile(
  plan: Classified<ProfilePlan>,
  read: Classified<SourcedHeights>,
  heights: ProfileHeights,
): Classified<ElevationProfile> {
  const flat: Classified<Float32Array> =
    read.classification === 'UNAVAILABLE' ? read : official(read.value.heights, heights.description)
  const profile = profileFromHeights(plan, flat, { source: heights.description, noDataReason: heights.noDataReason })
  if (profile.classification !== 'DERIVED' || read.classification === 'UNAVAILABLE') return profile
  const { sourceIndex, sources } = read.value
  const samples = profile.value.samples.map((sample, i) =>
    sample.elevationMeters.classification === 'OFFICIAL'
      ? { ...sample, elevationMeters: official(sample.elevationMeters.value, sources[sourceIndex[i]].source) }
      : sample,
  )
  return { ...profile, value: { ...profile.value, samples } }
}

/** The profile along `path`: `planFor` then `readProfile`, for callers outside React. */
export function sampleProfile(
  path: readonly MarsCoordinate[],
  heights: ProfileHeights,
  signal: AbortSignal,
): Promise<Classified<ElevationProfile>> {
  return readProfile(planFor(path, heights), heights, signal)
}
