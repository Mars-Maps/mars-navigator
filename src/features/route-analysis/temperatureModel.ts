import {
  derived,
  isAvailable,
  localTrueSolarTimeHours,
  MARS24_METHOD,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MarsSolarTime,
  type TemperatureEstimate,
  type TemperatureModel,
  type ThermalPropertiesLookup,
} from '../../domain'
import {
  DEFAULT_CHOICES,
  diurnalCurve,
  SURFACE_PRESSURE_METHOD,
  temperatureAtHour,
  type DiurnalCurve,
  type DiurnalInputs,
  type ThermalModelChoices,
} from './thermalModel'

/**
 * The temperature model the point menu calls: `temperatureAt
 * (point, solar)`, synchronous, DERIVED or UNAVAILABLE. The shell binds
 * the sources; this file turns one call into a cached diurnal run and
 * reads it at the point's local true solar time, so the clock's minute
 * tick costs a lookup, not a run.
 */

/** Where the grids ran out: the TES maps are infilled between these latitudes. */
export const THERMAL_GRID_LATITUDE_LIMIT_DEG = 87

/**
 * The error the estimate carries, ± kelvin, and how it was found. Set from
 * the runs against measurements, never guessed (Jezero and Gale):
 * the test in tests/unit/thermalModelValidation.test.ts recomputes both
 * and fails if either site drifts past it. One bound everywhere: the
 * method names the two sites it was measured at, and the estimate is no
 * better anywhere else.
 */
export const VALIDATED_ERROR = {
  errorK: 10,
  basis:
    'one bound for both rover sites: the larger root-mean-square difference between the modelled and the measured sol minimum and maximum, rounded up to a kelvin, runs of 2026-11-07. ' +
    'Jezero, Perseverance MEDA TIRS ground brightness temperature, 109 sols (every tenth sol with the cold and warm hours sampled, sols 1–1859), on the TES grids’ cell at the Jezero centre (thermal inertia 283, albedo 0.1681): night +0.6 K mean, 5.9 K rms; day −2.3 K mean, 8.3 K rms; together 7.2 K rms, worst 25 K on a single sol; the dust and sky choices were set on the first run of this comparison (2026-10-31), so it is not independent. ' +
    'Gale, Curiosity REMS ground temperature sensor (the mars.nasa.gov outreach copy, integer °C, no times, so sol extremes against sol extremes), 236 sols (every 20th sol with both values, sols 10–4980), on the TES grids’ 0.5° cell at Bradbury Landing (thermal inertia 126, albedo 0.2323): night −7.9 K mean, 10.0 K rms; day +2.0 K mean, 8.5 K rms; together 9.3 K rms, worst 53 K on a single sol; nothing was fitted on Gale, so it is the independent check, and its colder nights are the open question',
}

export interface TemperatureModelSources {
  properties: ThermalPropertiesLookup
  /** Surface pressure for the point, pascals: from the elevation chain, or UNAVAILABLE with the elevation's reason. */
  surfacePressurePa: (point: MarsCoordinate) => Classified<number>
  choices?: ThermalModelChoices
  /** The error to report; the validated one unless a test says otherwise. */
  error?: { errorK: number; basis: string }
}

/** Reasons the estimate is UNAVAILABLE, so the UI and tests can tell them apart. */
export const TEMPERATURE_MODEL_REASONS = {
  outsideBand: `No thermal inertia or albedo poleward of ${THERMAL_GRID_LATITUDE_LIMIT_DEG}°: the TES maps stop there`,
} as const

export function createTemperatureModel(sources: TemperatureModelSources): TemperatureModel {
  const choices = sources.choices ?? DEFAULT_CHOICES
  const error = sources.error ?? VALIDATED_ERROR
  const cache = new CurveCache(choices)
  return (point, solar) => {
    if (Math.abs(point.latitude) > THERMAL_GRID_LATITUDE_LIMIT_DEG) {
      return unavailable(TEMPERATURE_MODEL_REASONS.outsideBand)
    }
    const { thermalInertia, albedo } = sources.properties(point)
    if (!isAvailable(thermalInertia)) return unavailable(`No thermal inertia at this point: ${thermalInertia.reason}`)
    if (!isAvailable(albedo)) return unavailable(`No albedo at this point: ${albedo.reason}`)
    const pressure = sources.surfacePressurePa(point)
    if (!isAvailable(pressure)) return unavailable(`No surface pressure at this point: ${pressure.reason}`)
    const inputs: DiurnalInputs = {
      latitudeDeg: point.latitude,
      solarDeclinationDeg: solar.subsolarPoint.latitude,
      heliocentricDistanceAu: solar.heliocentricDistanceAu,
      thermalInertia: thermalInertia.value,
      albedo: albedo.value,
      surfacePressurePa: pressure.value,
    }
    let curve: DiurnalCurve
    try {
      curve = cache.curveFor(inputs)
    } catch (e: unknown) {
      return unavailable(`The model cannot run here: ${e instanceof Error ? e.message : String(e)}`)
    }
    const hours = localTrueSolarTimeHours(solar, point.longitudeEast)
    const temperatureK = temperatureAtHour(curve, hours)
    const estimate: TemperatureEstimate = { temperatureK, errorK: error.errorK }
    return derived(estimate, describeMethod(inputs, solar, hours, curve, choices, error, sourceOf(thermalInertia), sourceOf(albedo), sourceOf(pressure)))
  }
}

const sourceOf = (v: Extract<Classified<number>, { value: number }>) =>
  v.classification === 'DERIVED' ? v.method : v.source

/** The DERIVED method the badge shows: the model, every input with its source, the choices and the error. */
function describeMethod(
  inputs: DiurnalInputs,
  solar: MarsSolarTime,
  hours: number,
  curve: DiurnalCurve,
  choices: ThermalModelChoices,
  error: { errorK: number; basis: string },
  inertiaSource: string,
  albedoSource: string,
  pressureSource: string,
): string {
  const night = curve.sunRises ? '' : ' Polar night: the sun does not rise this sol.'
  return (
    `Model estimate, not a measurement: a one-dimensional surface heat balance after KRC (Kieffer 2013, J. Geophys. Res. Planets 118, doi 10.1002/jgre.20073): ` +
    `sunlight through dust, less the albedo, against thermal radiation and conduction into a ground set by its thermal inertia, run to a repeating sol at this season and read at the point’s local true solar time. ` +
    `Inputs: thermal inertia ${inputs.thermalInertia.toFixed(0)} J m⁻² K⁻¹ s⁻¹ᐟ² (${inertiaSource}); albedo ${inputs.albedo.toFixed(3)} (${albedoSource}); ` +
    `Ls ${solar.solarLongitudeDeg.toFixed(1)}°, Mars–Sun distance ${inputs.heliocentricDistanceAu.toFixed(3)} AU and local true solar time ${formatHours(hours)} (${MARS24_METHOD}); ` +
    `surface pressure ${inputs.surfacePressurePa.toFixed(0)} Pa (${pressureSource}; ${SURFACE_PRESSURE_METHOD}). ` +
    `Project choices, not measurements: emissivity ${choices.emissivity}, dust optical depth ${choices.opticalDepth}, sky radiation ${(choices.skyFraction * 100).toFixed(0)} % of noon insolation; CO2 frost floor ${curve.frostPointK.toFixed(1)} K.${night} ` +
    `Not modelled: slopes and shadows, dust storms, the seasonal pressure cycle, the ground’s layering. ` +
    `Error ± ${error.errorK} K: ${error.basis}`
  )
}

function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.floor((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Runs are cached on their rounded inputs: a tenth of a degree of latitude
 * and declination, a thousandth of an AU, whole units of thermal inertia,
 * 0.005 of albedo and 10 Pa, all finer than the inputs’ own precision. So
 * the clock's tick, and every point in one grid cell, read one run.
 */
export class CurveCache {
  private readonly curves = new Map<string, DiurnalCurve>()
  private readonly choices: ThermalModelChoices
  private readonly capacity: number
  constructor(choices: ThermalModelChoices, capacity = 64) {
    this.choices = choices
    this.capacity = capacity
  }

  curveFor(inputs: DiurnalInputs): DiurnalCurve {
    const key = [
      inputs.latitudeDeg.toFixed(1),
      inputs.solarDeclinationDeg.toFixed(1),
      inputs.heliocentricDistanceAu.toFixed(3),
      inputs.thermalInertia.toFixed(0),
      (Math.round(inputs.albedo / 0.005) * 0.005).toFixed(3),
      (Math.round(inputs.surfacePressurePa / 10) * 10).toFixed(0),
    ].join('|')
    const hit = this.curves.get(key)
    if (hit !== undefined) {
      // Re-insert so the map's order is the recency order.
      this.curves.delete(key)
      this.curves.set(key, hit)
      return hit
    }
    const curve = diurnalCurve(inputs, this.choices)
    this.curves.set(key, curve)
    if (this.curves.size > this.capacity) {
      const oldest = this.curves.keys().next().value
      if (oldest !== undefined) this.curves.delete(oldest)
    }
    return curve
  }

  get size(): number {
    return this.curves.size
  }
}
