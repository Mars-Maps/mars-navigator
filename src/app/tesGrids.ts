import { TES_GRIDS_READING_REASON } from '../data/adapters/thermalGridReasons'
import type { TesThermalGrids } from '../data/adapters/ThermalGridAdapter'
import { unavailable } from '../domain'
import type { createTemperatureModel } from '../features/route-analysis/temperatureModel'

/** The grids and, with them, the model that runs on them: both load as one chunk, neither is in the first load. */
export interface TesGridsAndModel {
  grids: TesThermalGrids
  createTemperatureModel: typeof createTemperatureModel
}

/**
 * The TES thermal inertia and albedo grids, read once for the life
 * of the page and shared by the point menu's temperature model and
 * the thermal layer's grid variants. The adapter and the grids
 * (about 1 MB) are their own chunk, fetched on first need. The
 * grids are the build's own files, so a failure is the deploy's, not the
 * network's: it is kept, with its reason, and not retried.
 */
let loaded: Promise<TesGridsAndModel> | null = null

export function loadTesGridsOnce(): Promise<TesGridsAndModel> {
  loaded ??= Promise.all([
    import('../data/adapters/ThermalGridAdapter').then((m) => m.loadTesThermalGrids(new AbortController().signal)),
    import('../features/route-analysis/temperatureModel'),
  ])
    .then(([grids, model]) => ({ grids, createTemperatureModel: model.createTemperatureModel }))
    // A chunk failed to load; the grids' own failures come back as lookups. With no model, every estimate says why.
    .catch((error: unknown) => {
      const reason = TES_GRIDS_FAILED_REASON(error)
      return { grids: tesGridsFailed(reason), createTemperatureModel: () => () => unavailable(reason) }
    })
  return loaded
}

export const TES_GRIDS_FAILED_REASON = (error: unknown) =>
  `The TES thermal inertia and albedo grids could not be loaded: ${error instanceof Error ? error.message : String(error)}`

/** Every lookup and both sets UNAVAILABLE with one reason: the adapter's own shape, built here because the adapter did not load. */
function tesGridsFailed(reason: string): TesThermalGrids {
  const lookup = () => unavailable<number>(reason)
  return {
    thermalInertia: lookup,
    albedo: lookup,
    properties: () => ({ thermalInertia: unavailable(reason), albedo: unavailable(reason) }),
    sets: { thermalInertia: { failed: reason }, albedo: { failed: reason } },
  }
}

export { TES_GRIDS_READING_REASON }
