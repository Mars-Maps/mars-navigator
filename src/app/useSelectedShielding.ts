import { useEffect, useState } from 'react'
import { unavailable, type Classified } from '../domain'
import { useMissionStore } from '../state'
import { elevation } from './elevation'
import { readFor, shieldingFromElevation, type PointRead } from './shielding'

/**
 * The selected point's height and the atmosphere overhead derived from it,
 * for the point menu: one read from
 * the elevation chain, then the domain's rule, so the height and the
 * shielding always agree. null with no point and while the read is out; a
 * read abandoned by a new selection writes nothing.
 */
export function useSelectedShielding(): Omit<PointRead, 'at'> | null {
  const point = useMissionStore((s) => s.selectedPoint)
  const [read, setRead] = useState<PointRead | null>(null)
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
        if (!controller.signal.aborted) {
          setRead({ at: point, elevation: height, shielding: shieldingFromElevation(height) })
        }
      })
    return () => controller.abort()
  }, [point])
  return readFor(read, point)
}
