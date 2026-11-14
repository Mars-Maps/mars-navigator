import { localTrueSolarTimeHours, type MarsSolarTime } from '../../domain'
import { THERMAL_GRID_LATITUDE_LIMIT_DEG, VALIDATED_ERROR } from './temperatureModel'
import { MEAN_SURFACE_PRESSURE_PA, MEAN_SURFACE_PRESSURE_SOURCE } from './surfacePressure'
import { DEFAULT_CHOICES, diurnalCurve, diurnalInputsProblem, type DiurnalInputs } from './thermalModel'

/**
 * The modelled surface temperature as a layer: the point menu's
 * model run over every cell of the TES grids at the mission clock's
 * season, then read at each cell's local true solar time. A run costs
 * about 6 ms, so the cells are grouped into bins of latitude, thermal
 * inertia and albedo and one run serves each bin; the clock's hour then
 * costs a lookup per cell, so the sun slider repaints at once. Pure: the
 * shell feeds the grids and paints the result, a worker runs the curves.
 */

/** A grid of the two TES properties, NaN where a cell has none; row-major, north to south, west to east. */
export interface ThermalInputGrid {
  widthPx: number
  heightPx: number
  pxPerDeg: number
  westDeg: number
  northDeg: number
  thermalInertia: Float32Array
  albedo: Float32Array
}

/**
 * The bins one run serves (a project choice, stated in the method): a 2°
 * band of latitude, thermal inertia within a factor of 1.25, albedo within
 * 0.03. On the committed grids that is about 7,000 runs for 233,000 cells.
 */
export const LAYER_BINS = { latitudeDeg: 2, inertiaFactor: 1.25, albedo: 0.03 } as const

/** Samples kept per curve, ten Mars minutes apart; the model steps every minute. */
export const LAYER_CURVE_STEPS = 144

/** A season bin: runs are kept while the sun's declination and the Mars–Sun distance stay within these. */
export const SEASON_BINS = { declinationDeg: 1, distanceAu: 0.01 } as const

export interface TemperatureLayerPlan {
  /** For each cell, the index of its run in `inputs`, or −1 for a cell with no inputs. */
  curveOf: Int32Array
  inputs: DiurnalInputs[]
  season: { declinationDeg: number; distanceAu: number }
}

const binLatitude = (lat: number) => Math.round(lat / LAYER_BINS.latitudeDeg) * LAYER_BINS.latitudeDeg
const binInertia = (ti: number) => Math.exp(Math.round(Math.log(ti) / Math.log(LAYER_BINS.inertiaFactor)) * Math.log(LAYER_BINS.inertiaFactor))
const binAlbedo = (a: number) => Math.round(a / LAYER_BINS.albedo) * LAYER_BINS.albedo

/** The season as the plan rounds it, so a clock tick within the bin reuses the runs. */
export function seasonOf(solar: MarsSolarTime): TemperatureLayerPlan['season'] {
  return {
    declinationDeg: Math.round(solar.subsolarPoint.latitude / SEASON_BINS.declinationDeg) * SEASON_BINS.declinationDeg,
    distanceAu: Math.round(solar.heliocentricDistanceAu / SEASON_BINS.distanceAu) * SEASON_BINS.distanceAu,
  }
}

/**
 * Which run each cell reads, and the distinct runs to make. Cells with no
 * thermal inertia or albedo, or poleward of the maps' band, get no run.
 */
export function planTemperatureLayer(grid: ThermalInputGrid, solar: MarsSolarTime): TemperatureLayerPlan {
  const season = seasonOf(solar)
  const curveOf = new Int32Array(grid.widthPx * grid.heightPx).fill(-1)
  const inputs: DiurnalInputs[] = []
  const index = new Map<string, number>()
  for (let row = 0; row < grid.heightPx; row++) {
    const lat = grid.northDeg - (row + 0.5) / grid.pxPerDeg
    // The TES maps stop at the band's edge; nothing poleward is run.
    if (Math.abs(lat) > THERMAL_GRID_LATITUDE_LIMIT_DEG) continue
    const latBin = Math.max(-THERMAL_GRID_LATITUDE_LIMIT_DEG, Math.min(THERMAL_GRID_LATITUDE_LIMIT_DEG, binLatitude(lat)))
    for (let col = 0; col < grid.widthPx; col++) {
      const i = row * grid.widthPx + col
      const ti = grid.thermalInertia[i]
      const a = grid.albedo[i]
      if (!Number.isFinite(ti) || !Number.isFinite(a)) continue
      const candidate: DiurnalInputs = {
        latitudeDeg: latBin,
        solarDeclinationDeg: season.declinationDeg,
        heliocentricDistanceAu: season.distanceAu,
        thermalInertia: binInertia(ti),
        albedo: Math.min(0.99, binAlbedo(a)),
        surfacePressurePa: MEAN_SURFACE_PRESSURE_PA,
      }
      if (diurnalInputsProblem(candidate) !== null) continue
      const key = `${candidate.latitudeDeg}|${candidate.thermalInertia.toFixed(3)}|${candidate.albedo.toFixed(3)}`
      let at = index.get(key)
      if (at === undefined) {
        at = inputs.length
        index.set(key, at)
        inputs.push(candidate)
      }
      curveOf[i] = at
    }
  }
  return { curveOf, inputs, season }
}

/**
 * The runs for `inputs[from, to)`, each sampled to LAYER_CURVE_STEPS from
 * local midnight, laid end to end. What a worker computes for its slice.
 */
export function runLayerCurves(inputs: readonly DiurnalInputs[], from = 0, to = inputs.length): Float32Array {
  const out = new Float32Array((to - from) * LAYER_CURVE_STEPS)
  for (let n = from; n < to; n++) {
    const curve = diurnalCurve(inputs[n], DEFAULT_CHOICES)
    const base = (n - from) * LAYER_CURVE_STEPS
    for (let s = 0; s < LAYER_CURVE_STEPS; s++) {
      // The model's step nearest this sample.
      out[base + s] = curve.temperaturesK[Math.round((s / LAYER_CURVE_STEPS) * curve.stepsPerSol) % curve.stepsPerSol]
    }
  }
  return out
}

/** The temperature at a local time from a sampled curve, interpolated between samples; kelvin. */
export function sampledCurveAt(curves: Float32Array, curve: number, localTrueSolarHours: number): number {
  const n = LAYER_CURVE_STEPS
  const pos = (((localTrueSolarHours / 24) * n) % n + n) % n
  const i = Math.floor(pos)
  const t = pos - i
  const base = curve * n
  return curves[base + i] * (1 - t) + curves[base + ((i + 1) % n)] * t
}

/**
 * Every cell's temperature at the instant, kelvin, NaN for a cell with no
 * run: each column's local true solar time is found once, then each cell
 * reads its run there.
 */
export function layerTemperaturesK(
  grid: ThermalInputGrid,
  plan: TemperatureLayerPlan,
  curves: Float32Array,
  solar: MarsSolarTime,
): Float32Array {
  const out = new Float32Array(plan.curveOf.length).fill(Number.NaN)
  const hours = new Float64Array(grid.widthPx)
  for (let col = 0; col < grid.widthPx; col++) {
    const lon = grid.westDeg + (col + 0.5) / grid.pxPerDeg
    hours[col] = localTrueSolarTimeHours(solar, (lon + 360) % 360)
  }
  for (let i = 0; i < out.length; i++) {
    const c = plan.curveOf[i]
    if (c < 0) continue
    out[i] = sampledCurveAt(curves, c, hours[i % grid.widthPx])
  }
  return out
}

/**
 * What the layer says of itself before its first runs are done: DERIVED from
 * the start, the figures to follow.
 */
export const TEMPERATURE_LAYER_PENDING_METHOD =
  'Model estimate, not a measurement: the surface heat balance after KRC (Kieffer 2013) is being run over the TES thermal inertia and albedo grids for this season; the bins, the run count and the error bound are written here once the runs finish'

/** The DERIVED method the layer's legend and caption carry: the model, the bins, the fixed pressure, the error. */
export function temperatureLayerMethod(plan: TemperatureLayerPlan, solar: MarsSolarTime): string {
  return (
    `Model estimate, not a measurement: the point menu's surface heat balance after KRC (Kieffer 2013, doi 10.1002/jgre.20073) run over the TES thermal inertia and albedo grids at Ls ${solar.solarLongitudeDeg.toFixed(1)}° ` +
    `(declination ${plan.season.declinationDeg.toFixed(0)}°, ${plan.season.distanceAu.toFixed(2)} AU), read at each cell's local true solar time. ` +
    `Cells are grouped so one run serves a ${LAYER_BINS.latitudeDeg}° band of latitude, thermal inertia within a factor of ${LAYER_BINS.inertiaFactor} and albedo within ${LAYER_BINS.albedo}: ${plan.inputs.length} runs for this season. ` +
    `Surface pressure ${MEAN_SURFACE_PRESSURE_PA} Pa everywhere (${MEAN_SURFACE_PRESSURE_SOURCE}), which sets only the CO2 frost floor; the point menu's estimate uses the point's own elevation and exact inputs, so it is the better figure at a point. ` +
    `Error ± ${VALIDATED_ERROR.errorK} K before the grouping: ${VALIDATED_ERROR.basis}`
  )
}
