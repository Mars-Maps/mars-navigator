import type { GeologicMap } from '../../domain'
import { TREK_ARCGIS_URL } from '../layers/layerSources'
import { JEZERO, JEZERO_FEATURE_SERVICE, JEZERO_LAYERS, SIM_3464 } from '../sites/sites'

/**
 * Where the geologic units and mapped features come from: the
 * detailed SIM 3464 sheet over Jezero, the global SIM 3292 map everywhere
 * else. Field names and layer ids as the services listed them on
 * 2026-10-31; nothing above the adapter sees them.
 */

/** USGS SIM 3292, the global map a point falls back to outside the Jezero sheet. */
export const SIM_3292: GeologicMap = {
  id: 'SIM 3292',
  title: 'Geologic map of Mars',
  scaleDenominator: 20_000_000,
  citation:
    'Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., Irwin, R.P., III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., and Hare, T.M., 2014, Geologic map of Mars: U.S. Geological Survey Scientific Investigations Map 3292, scale 1:20,000,000, https://doi.org/10.3133/sim3292',
}

export interface UnitSource {
  map: GeologicMap
  serviceUrl: string
  layerId: number
  /** The attribute fields the unit is read from, as the service names them. */
  fields: { symbol: string; name: string; description?: string; interpretation?: string; legendCode?: string }
}

/** SIM 3464 "Geologic Units" (layer 8): 1,308 polygons, 14 units. */
export const JEZERO_UNITS: UnitSource & { sheet: typeof JEZERO.bounds } = {
  map: SIM_3464,
  serviceUrl: JEZERO_FEATURE_SERVICE,
  layerId: JEZERO_LAYERS.geologicUnits,
  fields: { symbol: 'symbol', name: 'name', description: 'Unit_Description', legendCode: 'unit', interpretation: 'Unit_Interpretation' },
  // The map sheet: a point outside it is never asked of this service.
  sheet: JEZERO.bounds,
}

/** SIM 3292 on NASA Mars Trek (layer 0): 44 units, no descriptions served. */
export const GLOBAL_UNITS: UnitSource = {
  map: SIM_3292,
  serviceUrl: `${TREK_ARCGIS_URL}/SIM3292_Global_Geology/MapServer`,
  layerId: 0,
  fields: { symbol: 'Unit', name: 'UnitDesc' },
}

/**
 * The SIM 3464 layers the walk planner treats as mapped obstacles, each feature's kind
 * in its `TYPE` field, verbatim ("ridge crest (type 1), certain").
 */
export const JEZERO_FEATURE_LAYERS = {
  /** Location Features: 341 points, all "small crater". */
  points: 4,
  /** Linear Features: ridge crests, crater rim crests, delta lobe fronts, channels, lineaments. */
  lines: 6,
  /** Surface Features: "ridged" and "dark-colored mantling material" areas. */
  areas: 7,
} as const

export const FEATURE_KIND_FIELD = 'TYPE'

/**
 * How far the service may move a vertex when it simplifies a unit polygon:
 * 0.0005° is about 30 m on Mars, under half a millimetre on the 1:75,000
 * sheet. A box around the landing site comes back in about 12,000 vertices
 * instead of the 48 MB layer. The feature layers are not simplified.
 */
export const SIMPLIFY_DEG = 0.0005
