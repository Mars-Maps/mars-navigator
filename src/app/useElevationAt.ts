import { useEffect, useState } from 'react'
import { unavailable, type Classified, type MarsCoordinate } from '../domain'
import { elevation } from './elevation'

/**
 * One point's height from the elevation chain, for the stop card. null
 * with no point and while the read is out; a read abandoned by a new point
 * writes nothing, so one stop's height never shows under another.
 */
export function useElevationAt(point: MarsCoordinate | null): Classified<number> | null {
  const [read, setRead] = useState<{ at: MarsCoordinate; height: Classified<number> } | null>(null)
  useEffect(() => {
    if (!point) return
    const controller = new AbortController()
    elevation
      .elevationAt(point, controller.signal)
      // The adapters answer a failed load as UNAVAILABLE and do not reject; this is a guard.
      .catch((e: unknown): Classified<number> =>
        unavailable(`The elevation read failed: ${e instanceof Error ? e.message : String(e)}`),
      )
      .then((height) => {
        if (!controller.signal.aborted) setRead({ at: point, height })
      })
    return () => controller.abort()
  }, [point])
  return point !== null && read?.at === point ? read.height : null
}
