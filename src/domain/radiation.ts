import type { Classified } from './classification'

/** A measured quantity with the uncertainty its source states, both in `unit`. */
export interface MeasuredValue {
  value: number
  uncertainty: number
  unit: string
}

/**
 * One published surface radiation measurement, shown as a reference wherever
 * no measurement exists. It belongs to its site and
 * period: it is never scaled to another place or time. Radiation at any
 * other point stays UNAVAILABLE.
 */
export interface RadiationReference {
  /** Where it was measured, e.g. "Gale crater". */
  site: string
  /** The instrument, e.g. "Curiosity RAD". */
  instrument: string
  /** Elevation of the site on the MOLA datum, km. */
  elevationKm: number
  /** The measurement period, as the source states it. */
  period: string
  /** Solar-cycle conditions during the period, as the source states them. */
  conditions: string
  /** Galactic cosmic ray dose equivalent rate, mSv/day. */
  doseEquivalent: Classified<MeasuredValue>
  /** Galactic cosmic ray absorbed dose rate, mGy/day. */
  absorbedDose: Classified<MeasuredValue>
  /** The average quality factor relating the two, dimensionless. */
  qualityFactor: Classified<MeasuredValue>
}

/**
 * "0.64 ± 0.12 mSv/day": value and uncertainty to the same number of
 * decimals, as the source printed them, so neither claims more precision.
 */
export function formatMeasuredValue({ value, uncertainty, unit }: MeasuredValue, decimals: number): string {
  const unitPart = unit === '' ? '' : ` ${unit}`
  return `${value.toFixed(decimals)} ± ${uncertainty.toFixed(decimals)}${unitPart}`
}

/*
 * The atmospheric shielding rule: how much atmosphere
 * is overhead at a point, relative to Gale where the one surface dose was
 * measured. A warning about shielding, never a dose: nothing here turns the
 * fraction into millisieverts, because no published formula does.
 */

/** NASA NSSDCA Mars Fact Sheet, "Scale height: 11.0 km", checked 2026-10-28. */
export const MARS_SCALE_HEIGHT_KM = 11.0
export const MARS_SCALE_HEIGHT_SOURCE =
  'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html — "Scale height: 11.0 km" (checked 2026-10-28)'

/** Where Curiosity RAD measured (Hassler et al. 2014): Gale crater, −4.4 km MOLA. Same figure as the Gale reference in src/data. */
export const GALE_RAD_ELEVATION_KM = -4.4
export const GALE_RAD_ELEVATION_SOURCE =
  'Hassler et al. 2014, Science 343:1244797 — "Gale Crater (-4.4 km MOLA)"'

/**
 * Warn when the column overhead is under this fraction of Gale's: at least
 * a fifth less atmosphere than where the dose was measured. A project
 * choice, not a standard: it is the one round value that
 * flags the Jezero rim crests (f ≈ 0.77–0.80 on the CTX model) and leaves
 * the crater floor, the landing site and the delta (0.84–0.85) alone.
 */
export const SHIELDING_WARNING_FRACTION = 0.8
// The words are read in the app, so they say what the warning line means.
export const SHIELDING_WARNING_BASIS =
  'Project choice, not an agency limit: at least a fifth less atmosphere overhead than at Gale, where the only surface dose was measured'

/** The unit of a radiation hazard's magnitude: the column fraction, not a dose. */
export const RADIATION_HAZARD_UNIT = 'fraction of the Gale column'
export type RadiationHazardUnit = typeof RADIATION_HAZARD_UNIT

/** "−4.4", "11.0": one decimal and a true minus, as the sources print them and the UI shows heights. */
const formatKm = (km: number) => `${km < 0 ? '−' : ''}${Math.abs(km).toFixed(1)}`

/** What the fraction states as its DERIVED method. Reaches the UI as the badge's detail. */
export const SHIELDING_METHOD = `Relative column mass exp(−(h − h_Gale) / H): h the point's elevation from the elevation chain, h_Gale = ${formatKm(GALE_RAD_ELEVATION_KM)} km (where Curiosity RAD measured), H = ${formatKm(MARS_SCALE_HEIGHT_KM)} km (NASA Mars Fact Sheet scale height). A global mean; season, latitude and weather move the surface pressure by tens of percent and are not included. Less atmosphere means less shielding; the dose itself is not derived`

/** The text a radiation hazard carries, which the UI shows as is. */
export const SHIELDING_WARNING_TEXT =
  'Less atmospheric shielding than at Gale, where the only surface dose was measured. Dose here: UNAVAILABLE'

/**
 * The column mass overhead at `elevationM` (metres above the MOLA areoid)
 * as a fraction of Gale's: 1 at Gale, under 1 on higher ground, over 1 in
 * deeper basins. NaN for a non-finite height, so a missing elevation can
 * never read as "the same as Gale".
 */
export function columnMassFraction(elevationM: number): number {
  if (!Number.isFinite(elevationM)) return Number.NaN
  return Math.exp(-(elevationM / 1000 - GALE_RAD_ELEVATION_KM) / MARS_SCALE_HEIGHT_KM)
}

/** True when the fraction is under the warning line. False for NaN: no height, no warning, and no all-clear either. */
export function isShieldingWarning(fraction: number): boolean {
  return fraction < SHIELDING_WARNING_FRACTION
}

/** The height above which the warning holds: h_Gale − H·ln(threshold), in metres. */
export function shieldingWarningElevationM(): number {
  return (GALE_RAD_ELEVATION_KM - MARS_SCALE_HEIGHT_KM * Math.log(SHIELDING_WARNING_FRACTION)) * 1000
}

/*
 * The radiation level: three words on the same
 * fraction, so the point menu, the hazards panel and the stop card say one
 * thing. A shielding level relative to Gale, never a dose.
 */
export type RadiationLevel = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * The two lines between the levels, as fractions of Gale's column. LOW is at
 * least as much atmosphere overhead as where the only surface dose was
 * measured (f ≥ 1); HIGH is the warning line (f < 0.80);
 * MEDIUM lies between. No third figure is invented: the lines are Gale
 * itself and the existing warning.
 */
export const RADIATION_LEVEL_LINES = {
  /** At or above this fraction the level is LOW. */
  low: 1,
  /** Under this fraction the level is HIGH. */
  high: SHIELDING_WARNING_FRACTION,
} as const

/** The level for a fraction; null for NaN, so no height never reads as a level. */
export function radiationLevel(fraction: number): RadiationLevel | null {
  if (!Number.isFinite(fraction)) return null
  if (fraction < RADIATION_LEVEL_LINES.high) return 'HIGH'
  if (fraction < RADIATION_LEVEL_LINES.low) return 'MEDIUM'
  return 'LOW'
}

/** What each level means, in the rule's words. Shown as is. */
export const RADIATION_LEVEL_TEXT: Record<RadiationLevel, string> = {
  LOW: 'At least as much atmosphere overhead as at Gale, where the only surface dose was measured',
  MEDIUM: 'Less atmosphere overhead than at Gale, by up to a fifth',
  HIGH: SHIELDING_WARNING_TEXT,
}

export const RADIATION_LEVEL_BASIS =
  'A shielding level relative to Gale, not a dose: LOW at or above Gale\'s column (1.00), HIGH under the warning line (0.80, a project choice, not an agency limit), MEDIUM between. Dose is not derived from it'
