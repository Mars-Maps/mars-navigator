import { useEffect, useMemo, useState } from 'react'
import {
  derived,
  isAvailable,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type TemperatureModel,
} from '../domain'
import { surfacePressurePa } from '../features/route-analysis/surfacePressure'
import type { PointRead } from './shielding'
import { TES_GRIDS_READING_REASON, loadTesGridsOnce, type TesGridsAndModel } from './tesGrids'

export { TES_GRIDS_FAILED_REASON } from './tesGrids'

/** Why the model has no pressure, so the UI and tests can tell the cases apart. */
export const PRESSURE_REASONS = {
  reading: 'Reading the elevation here…',
  notSelected: 'The elevation, and so the pressure, is read only for the selected point',
} as const

/**
 * The temperature model the point menu calls: bound here to the
 * TES thermal inertia and albedo grids and to the selected
 * point's elevation read, the same read that fills the Elevation row and
 * the shielding, so the pressure and the height never disagree.
 *
 * The grids (about 1 MB) and their adapter are read once, in their own
 * chunk, when a point is first selected or the thermal layer's grid
 * variants are shown (`loadTesGridsOnce`), and kept for the page's
 * life; until they land every point answers UNAVAILABLE with the reading
 * reason, and a failed read, of the chunk or of a grid, keeps its reason
 * (the grids are the build's own files, so a failure is the deploy's, not
 * the network's, and is not retried). A read abandoned on unmount, or by
 * deselecting while it is out, writes nothing here; the shared load goes
 * on and the next selection reads it at once.
 *
 * The model is synchronous: the selected point gets UNAVAILABLE while its
 * read is out, any other point gets UNAVAILABLE saying so, and the menu
 * re-runs it when the read or the grids land, since the model is a new
 * function then. So is its curve cache: it lives as long as one selection
 * and one set of grids, so nothing computed on the loading lookup survives
 * the grids' arrival.
 */
export function useTemperatureModel(pointRead: Omit<PointRead, 'at'> | null, point: MarsCoordinate | null): TemperatureModel {
  const loaded = useTesGridsAndModel(point !== null)
  return useMemo(() => {
    // Until the chunk lands the estimate says the grids are being read, as the lookup itself would.
    if (loaded === null) return readingModel
    const surfacePressure = (at: MarsCoordinate): Classified<number> => {
      if (point === null || at !== point) return unavailable(PRESSURE_REASONS.notSelected)
      if (pointRead === null) return unavailable(PRESSURE_REASONS.reading)
      return pressureFromElevation(pointRead.elevation)
    }
    return loaded.createTemperatureModel({ properties: loaded.grids.properties, surfacePressurePa: surfacePressure })
  }, [pointRead, point, loaded])
}

/**
 * The grids and the model's factory once `wanted`, from the shared load
 * (which never rejects: a failed read answers with its reason); null before.
 */
function useTesGridsAndModel(wanted: boolean): TesGridsAndModel | null {
  const [loaded, setLoaded] = useState<TesGridsAndModel | null>(null)
  useEffect(() => {
    if (!wanted || loaded !== null) return
    let cancelled = false
    loadTesGridsOnce().then((result) => {
      if (!cancelled) setLoaded(result)
    })
    return () => {
      cancelled = true
    }
  }, [wanted, loaded])
  return loaded
}

/** What the model answers before its chunk and the grids have loaded: the same words the lookup would give. */
const readingModel: TemperatureModel = () => unavailable(`No thermal inertia at this point: ${TES_GRIDS_READING_REASON}`)

/** Surface pressure from an elevation read: DERIVED naming the height's source, or UNAVAILABLE with its reason. */
export function pressureFromElevation(elevationM: Classified<number>): Classified<number> {
  if (!isAvailable(elevationM)) return unavailable(`No elevation at this point: ${elevationM.reason}`)
  const from = elevationM.classification === 'DERIVED' ? elevationM.method : elevationM.source
  return derived(surfacePressurePa(elevationM.value), `elevation ${formatMetres(elevationM.value)} m here: ${from}`)
}

/** "−2569": a true minus, as the UI prints heights. */
const formatMetres = (m: number) => `${m < 0 ? '−' : ''}${Math.abs(m).toFixed(0)}`
