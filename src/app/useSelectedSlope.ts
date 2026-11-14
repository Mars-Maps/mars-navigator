import { useEffect, useState } from 'react'
import { unavailable, type Classified, type MarsCoordinate } from '../domain'
import { elevation } from './elevation'

/**
 * One point's slope: `readSlope` on the app's elevation chain. null
 * with no point and while the read is out; a read abandoned by a new point
 * writes nothing. The read's code loads with the first point: the point
 * menu reads the slope too, and a static import put it over the
 * first load's 500 kB.
 */
export function useSlopeAt(point: MarsCoordinate | null): Classified<number> | null {
  const [read, setRead] = useState<{ at: MarsCoordinate; slope: Classified<number> } | null>(null)
  useEffect(() => {
    if (!point) return
    const controller = new AbortController()
    import('./slopeRead')
      .then(({ readSlope }) => readSlope(point, controller.signal, elevation))
      // The adapters answer a failed load as UNAVAILABLE and do not reject; this is a guard.
      .catch((e: unknown): Classified<number> =>
        unavailable(`The slope read failed: ${e instanceof Error ? e.message : String(e)}`),
      )
      .then((slope) => {
        if (!controller.signal.aborted) setRead({ at: point, slope })
      })
    return () => controller.abort()
  }, [point])
  return point !== null && read?.at === point ? read.slope : null
}
