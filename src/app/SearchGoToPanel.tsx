import { useEffect, useState } from 'react'
import { loadPlaceNames } from '../data/adapters/PlaceNamesAdapter'
import { featureSpanDeg, type SearchResult } from '../features/mission-ui/search/placeSearch'
import { SearchGoToView, type PlaceNamesStatus } from '../features/mission-ui/search/SearchGoTo'
import { useMissionStore } from '../state'

/**
 * The Search & Go To tool with its place names: the shell reads the
 * Gazetteer's names once, when the tool first opens, and Go to centres the
 * view on the result, framing a feature by its diameter (at the camera's
 * floor for a small one) and keeping the altitude for a point or coordinate.
 */
export function SearchGoToPanel({
  altitudeToFrame,
}: {
  /**
   * The camera's framing (`mars-3d/framing.ts`), passed in by the shell,
   * which already loads it: imported here it became a chunk of its own on
   * the first load, over the budget.
   */
  altitudeToFrame: (spanDeg: number) => number
}) {
  // Read here, as the Terrain Profile panels do: the shell no longer holds the marked points.
  const markers = useMissionStore((s) => s.markers)
  const [names, setNames] = useState<PlaceNamesStatus>({ kind: 'loading' })
  useEffect(() => {
    let live = true
    void loadPlaceNames().then((read) => {
      if (!live) return
      setNames(
        read.classification === 'UNAVAILABLE'
          ? { kind: 'failed', reason: read.reason }
          : { kind: 'ready', places: read.value, source: read.classification === 'OFFICIAL' ? read.source : '' },
      )
    })
    return () => {
      live = false
    }
  }, [])
  const goTo = (result: SearchResult) => {
    const altitude = result.diameterKm === null ? undefined : altitudeToFrame(featureSpanDeg(result.diameterKm))
    useMissionStore.getState().requestCenter(result.coordinate, altitude)
  }
  return <SearchGoToView names={names} markers={markers} onGoTo={goTo} />
}
