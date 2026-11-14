import { useEffect, useMemo, useState } from 'react'
import { unavailable, type Classified, type MarsCoordinate } from '../domain'
import type { ElevationProfile } from '../features/route-analysis/elevationProfile'
import { planFor, readProfile, SAMPLING_REASON, type ProfileHeights } from './routeProfile'

/**
 * The elevation profile along `path`, read from the elevation source,
 * for the navigation panel and the Terrain Profile tool. null with no path.
 * A path that cannot be profiled (empty, one point, zero length, antipodal)
 * answers at once with its reason; otherwise UNAVAILABLE "sampling" until
 * the read lands, and the read is abandoned when the path changes. In
 * Jezero a first profile from the 20 m model shows while the 1 m one is
 * read, then is replaced by it. The
 * path is keyed by its coordinates, so a new array with the same points
 * neither re-reads nor flickers.
 */
export function useProfile(
  path: readonly MarsCoordinate[] | null,
  heights: ProfileHeights,
): Classified<ElevationProfile> | null {
  const key = path === null ? null : keyOf(path)
  // Planned once per key, from the key itself: a number survives the round
  // trip through its string exactly, so this is the path the key names.
  const plan = useMemo(() => (key === null ? null : planFor(pathOf(key), heights)), [key, heights])
  const [done, setDone] = useState<{ key: string; profile: Classified<ElevationProfile> } | null>(null)

  useEffect(() => {
    if (key === null || plan === null || plan.classification === 'UNAVAILABLE') return
    const controller = new AbortController()
    // `readProfile` should never reject; if the source ever throws past its
    // own guards, the chart says so rather than staying on "sampling".
    const show = (profile: Classified<ElevationProfile>) => {
      if (!controller.signal.aborted) setDone({ key, profile })
    }
    void readProfile(plan, heights, controller.signal, show)
      .catch((error: unknown): Classified<ElevationProfile> => unavailable(error instanceof Error ? error.message : String(error)))
      .then(show)
    return () => controller.abort()
  }, [key, plan, heights])

  if (key === null || plan === null) return null
  if (plan.classification === 'UNAVAILABLE') return plan
  return done?.key === key ? done.profile : unavailable(SAMPLING_REASON)
}

/** The path as one string: its coordinates, full precision. Exported for tests. */
export function keyOf(path: readonly MarsCoordinate[]): string {
  return path.map((c) => `${c.latitude},${c.longitudeEast}`).join(';')
}

/** The path a key names. An empty key is the empty path. */
export function pathOf(key: string): MarsCoordinate[] {
  if (key === '') return []
  return key.split(';').map((pair) => {
    const [latitude, longitudeEast] = pair.split(',').map(Number)
    return { latitude, longitudeEast }
  })
}
