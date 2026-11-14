import type { MapLayer } from '../../domain'
import { rampSvgDataUrl, type RampStop } from '../../lib/colorRamp'
import { TES_BAND_DEG, type ThermalGrid } from '../adapters/ThermalGridAdapter'

/**
 * The thermal layer's two grid variants: the committed TES thermal
 * inertia drawn whole, and the project's modelled surface temperature on
 * the same cells. Both are 0.5° cells, 2 px/deg, the committed global
 * grids' resolution; the finer Jezero cut is not drawn,
 * the point menu keeps its values. The colour scales are this
 * project's choice, said so in each legend: the PDS grid publishes none,
 * and the model is ours.
 */

/** The TES thermal inertia grid's citation and archive, as its sidecar states them. */
export const TES_INERTIA_CITATION =
  'Putzig, N. E., and Mellon, M. T., 2007, Apparent thermal inertia of Mars from TES, Icarus 191, 68–94, doi 10.1016/j.icarus.2007.05.013; ' +
  'PDS Geosciences "TES Thermal Inertia Maps", MGS-M-TES-5-TIMAP-V1.0, GLOBAL_TI_DAY_2007 (dayside), 20 px/deg, ' +
  'https://pds-geosciences.wustl.edu/missions/mgs/tes-timap.html. Resampled to 0.5° cells by nearest cell (scripts/build-tes-grids.mjs); ' +
  'an apparent thermal inertia at the TES pass times, not a bulk property'

export const TES_LICENCE = 'Public domain (NASA PDS); cite the dataset and "NASA Planetary Data System"'

/** The unit, as the UI writes it. */
export const THERMAL_INERTIA_UNIT = 'J m⁻² K⁻¹ s⁻½'

/**
 * One blue hue, light to dark, over the range most of Mars lies in: dust
 * (under 100) light, bedrock and duricrust (over 400) dark. A project
 * choice; values beyond the ends take the end colour.
 */
export const INERTIA_RAMP: RampStop[] = [
  { value: 50, color: '#cde2fb' },
  { value: 100, color: '#9ec5f4' },
  { value: 200, color: '#5598e7' },
  { value: 300, color: '#2a78d6' },
  { value: 500, color: '#1c5cab' },
  { value: 800, color: '#0d366b' },
]

/** The no-data wording every grid layer shares. */
const GAPS = `Grey where the TES map has no value (dust-covered or infilled cells) and poleward of ${TES_BAND_DEG}°: the base map shows through, not a colour`

export const TES_INERTIA_LAYER: MapLayer = {
  id: 'thermal',
  label: 'Thermal (TES thermal inertia)',
  classification: 'OFFICIAL',
  source: TES_INERTIA_CITATION,
  provider: 'NASA PDS Geosciences Node',
  licence: TES_LICENCE,
  caveat: `Apparent thermal inertia in 0.5° cells, the colour scale this project's. ${GAPS}`,
  // The picker's tile shows the scale itself: the grid has no imagery of its own.
  previewUrl: rampSvgDataUrl(INERTIA_RAMP),
  legend: {
    kind: 'ramp',
    quantity: 'Apparent thermal inertia (TES, dayside)',
    unit: THERMAL_INERTIA_UNIT,
    stops: INERTIA_RAMP,
    classification: 'OFFICIAL',
    source: TES_INERTIA_CITATION,
    note: `Colour scale: this project's, not the producer's; the PDS grid publishes none. ${GAPS}`,
  },
}

/**
 * One warm hue, light where it is coldest to dark where it is warmest, over
 * the span Mars's surface reaches: a −130 °C polar night to a +20 °C
 * summer noon. A project choice; values beyond the ends take the end colour.
 */
export const TEMPERATURE_RAMP_C: RampStop[] = [
  { value: -130, color: '#fdebd9' },
  { value: -100, color: '#f8c39a' },
  { value: -70, color: '#f0925b' },
  { value: -40, color: '#e45f2a' },
  { value: -10, color: '#b8361b' },
  { value: 20, color: '#6e1a0d' },
]

/** The modelled-temperature layer, DERIVED with the method the shell computed it by and the model's validated error bound, kelvin. */
export function modelledTemperatureLayer(method: string, errorK: number): MapLayer {
  return {
    id: 'thermal',
    label: 'Thermal (modelled surface temperature)',
    classification: 'DERIVED',
    source: method,
    provider: 'This project (model on NASA PDS inputs)',
    licence: TES_LICENCE,
    caveat: `A model estimate at mission time, ± ${errorK} K, never a measurement; 0.5° cells, the colour scale this project's. ${GAPS}`,
    previewUrl: rampSvgDataUrl(TEMPERATURE_RAMP_C),
    legend: {
      kind: 'ramp',
      quantity: 'Modelled surface temperature at mission time',
      unit: '°C',
      stops: TEMPERATURE_RAMP_C,
      classification: 'DERIVED',
      source: method,
      note: `Colour scale: this project's. A model, not a measurement: ± ${errorK} K, validated at Jezero and Gale. ${GAPS}`,
    },
  }
}

/** A grid's cells as its quantity's values, NaN where it has none; row-major, north to south. */
export function gridValues(grid: ThermalGrid): Float32Array {
  const out = new Float32Array(grid.cells.length)
  for (let i = 0; i < out.length; i++) {
    const v = grid.cells[i]
    out[i] = v === 0 ? Number.NaN : v * grid.scale
  }
  return out
}
