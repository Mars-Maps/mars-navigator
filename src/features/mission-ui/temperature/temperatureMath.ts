import {
  CELSIUS_OFFSET_K,
  isAvailable,
  localTrueSolarTimeHours,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MarsSolarTime,
  type MeasuredGroundTemperature,
  type MeasuredTemperatureLookup,
  type TemperatureEstimate,
  type TemperatureModel,
} from '../../../domain'

/**
 * The point menu's Temperature field: the model's estimate
 * for the mission time, and the measured values above it where a rover
 * measured them. Pure, so a test can check that no number ever
 * appears without its mark. The shell hands in the model and the lookup;
 * until it does, the field stays UNAVAILABLE: no stand-in model runs in
 * the app.
 */

/** What the field needs besides the point. */
export interface TemperatureInputs {
  /** The mission time's Mars time (`PointMenu` works it out from the store's clock), so the time menu drives the estimate. */
  solar: Classified<MarsSolarTime>
  model: TemperatureModel | null
  measured: MeasuredTemperatureLookup | null
}

export interface TemperatureReading {
  /**
   * Shown first, and never replaced by the estimate. Null away from the two
   * sites; UNAVAILABLE at a site with no usable record (the feed still
   * loading or failed), with the reason.
   */
  measured: Classified<MeasuredGroundTemperature> | null
  estimate: Classified<TemperatureEstimate>
  /**
   * What the estimate is for: local true solar time at the point, Ls, and the
   * season there, with the Mars time method (DERIVED, Mars24). Null without an estimate.
   */
  conditions: { localSolarHours: number; solarLongitudeDeg: number; season: string; method: string } | null
}

export const NO_TEMPERATURE_REASON =
  'No per-point temperature lookup yet. The thermal layer is daytime infrared brightness, not calibrated temperature'

const NO_ESTIMATE: TemperatureReading = {
  measured: null,
  estimate: unavailable(NO_TEMPERATURE_REASON),
  conditions: null,
}

export function readTemperature(point: MarsCoordinate, inputs: TemperatureInputs | null): TemperatureReading {
  if (inputs === null) return NO_ESTIMATE
  const measured = inputs.measured?.(point) ?? null
  const { solar, model } = inputs
  if (model === null) return { ...NO_ESTIMATE, measured }
  if (!isAvailable(solar)) return { measured, estimate: unavailable(solar.reason), conditions: null }

  const estimate = model(point, solar.value)
  // A model bug must not reach the screen as "NaN °C".
  if (isAvailable(estimate) && !(Number.isFinite(estimate.value.temperatureK) && Number.isFinite(estimate.value.errorK))) {
    return { measured, estimate: unavailable('The temperature model returned no finite value here'), conditions: null }
  }
  return {
    measured,
    estimate,
    conditions: isAvailable(estimate)
      ? {
          localSolarHours: localTrueSolarTimeHours(solar.value, point.longitudeEast),
          solarLongitudeDeg: solar.value.solarLongitudeDeg,
          season: seasonAt(solar.value.solarLongitudeDeg, point.latitude),
          method: solar.classification === 'DERIVED' ? solar.method : solar.source,
        }
      : null,
  }
}

/** Kelvin to "−23 °C", with a true minus sign. */
export function formatCelsius(kelvin: number, decimals = 0): string {
  const c = kelvin - CELSIUS_OFFSET_K
  const text = Math.abs(c).toFixed(decimals)
  // −0.4 rounds to "0": no sign on a zero.
  return `${c < 0 && Number(text) !== 0 ? '−' : ''}${text} °C`
}

/**
 * "−23 °C ± 8 °C". Below 1 K of error, one decimal, so the value is not shown
 * coarser than its error. The error rounds up, so it is never shown smaller than it is.
 */
export function formatEstimate({ temperatureK, errorK }: TemperatureEstimate): string {
  const decimals = errorK < 1 ? 1 : 0
  const scale = 10 ** decimals
  // The small slack keeps a float such as 0.3 × 10 from rounding up a whole step.
  const shownError = Math.ceil(errorK * scale - 1e-9) / scale
  return `${formatCelsius(temperatureK, decimals)} ± ${shownError.toFixed(decimals)} °C`
}

/**
 * The season at the point, from Ls. Ls 0 is northern spring; the southern
 * hemisphere has the opposite season, so a point south of the equator reads
 * its own.
 */
export function seasonAt(solarLongitudeDeg: number, latitude: number): string {
  const quarter = Math.floor((((solarLongitudeDeg % 360) + 360) % 360) / 90)
  const north = ['spring', 'summer', 'autumn', 'winter'][quarter]
  const south = ['autumn', 'winter', 'spring', 'summer'][quarter]
  return latitude < 0 ? `southern ${south}` : `northern ${north}`
}
