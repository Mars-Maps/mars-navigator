import type { Classified } from './classification'
import type { MarsCoordinate } from './mars'
import type { MarsSolarTime } from './time'

/**
 * Ground temperature measured on Mars. Two instruments report it:
 * Perseverance's MEDA TIRS at Jezero and Curiosity's REMS GTS at Gale. A
 * measurement is shown above any model estimate and is never
 * replaced by one; everywhere else the estimate stands alone, and says so.
 */
export interface MeasuredGroundTemperature {
  /** Where it was measured, e.g. "Jezero crater". */
  site: string
  /** The rover and instrument, e.g. "Perseverance MEDA TIRS". */
  instrument: string
  /** The sol the minimum and maximum are for, in the mission's own count. */
  sol: number
  /** Earth date of that sol, YYYY-MM-DD, as the source gives it. */
  dateUtc: string
  /** Areocentric solar longitude of the sol, degrees 0–360; null where the source does not state it. */
  solarLongitudeDeg: number | null
  /** The sol's minimum ground temperature, kelvin: OFFICIAL with its citation, or UNAVAILABLE where the record has no value. */
  minK: Classified<number>
  /** The sol's maximum, likewise. */
  maxK: Classified<number>
  /**
   * What the reader must know to use the numbers: a brightness temperature
   * rather than a kinetic one, an outreach feed rather than the archive,
   * which hours of the sol were sampled. One or two sentences.
   */
  caveat: string
}

/**
 * The measurement for a point. Null where no instrument is, which is
 * everywhere but the two sites. At a site: the latest usable sol's record,
 * or UNAVAILABLE with the reason (the live feed is still loading or failed,
 * no sol was sampled through the cold and warm hours).
 */
export type MeasuredTemperatureLookup = (point: MarsCoordinate) => Classified<MeasuredGroundTemperature> | null

/** Kelvin from the degrees Celsius a source prints: the unit's definition, not a model. */
export const CELSIUS_OFFSET_K = 273.15

/*
 * The model estimate: a surface temperature for any point at the
 * mission clock's season and local time, DERIVED from official inputs by a
 * stated method, never a measurement. Where a measurement exists it is
 * shown above the estimate and is never replaced by it.
 */

/** The model's answer for one point at one instant. */
export interface TemperatureEstimate {
  /** Surface kinetic temperature, kelvin. */
  temperatureK: number
  /**
   * The error recorded by the validation against measured ground
   * temperatures, ± kelvin: the method says over which sols and
   * instruments. The UI shows "X °C ± E".
   */
  errorK: number
}

/**
 * Surface temperature at a point for an instant's Mars time: DERIVED with
 * the model's method (inputs, choices, the validated error), or UNAVAILABLE
 * with the reason (no thermal inertia or albedo at the point, no elevation
 * for the pressure, outside the grids' 87°S–87°N band).
 */
export type TemperatureModel = (point: MarsCoordinate, solar: MarsSolarTime) => Classified<TemperatureEstimate>

/**
 * The two TES surface properties the model runs on: the albedo sets
 * the mean, the thermal inertia sets the day–night swing. Each OFFICIAL
 * with its citation, or UNAVAILABLE where the grid has no cell.
 */
export interface SurfaceThermalProperties {
  /** Apparent thermal inertia, J m⁻² K⁻¹ s⁻¹ᐟ² (SI thermal inertia units). */
  thermalInertia: Classified<number>
  /** Bolometric albedo, 0–1. */
  albedo: Classified<number>
}

export type ThermalPropertiesLookup = (point: MarsCoordinate) => SurfaceThermalProperties
