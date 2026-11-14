/**
 * How steep a stretch of an elevation profile is: the mean slope
 * between two consecutive samples, and the band it falls in. The bands are
 * universal, the same on every route, so a colour means one thing
 * everywhere. They are the project's own convention, not an official
 * limit: see `SLOPE_METHOD`.
 */

export type SlopeBand = 'gentle' | 'moderate' | 'steep'

/** The bands in order, each from its first degree of mean slope. */
export const SLOPE_BANDS: readonly { band: SlopeBand; fromDeg: number; label: string }[] = [
  { band: 'gentle', fromDeg: 0, label: 'under 5°' },
  { band: 'moderate', fromDeg: 5, label: '5–15°' },
  { band: 'steep', fromDeg: 15, label: '15° and over' },
]

/** What a slope value and its band mean, for the mark beside them. */
export const SLOPE_METHOD =
  'Mean slope over the stretch from the previous sample: the difference of the two heights over the great-circle distance between them, in degrees, uphill and downhill alike. Anything shorter than the sample spacing is averaged out. Bands: gentle under 5° (about 9% grade), moderate 5–15° (9–27%), steep 15° and over. These are the project\'s bands, read from trail-building guidance (sustained grades of 5–10%, difficult trails near 15%, site maxima of 15–25%) and from reported Mars rover drives (23–24° of tilt called close to the limit; about 15° in soft sand for a test rover). Not an official limit.'

const toDegrees = (rad: number) => (rad * 180) / Math.PI

/**
 * The mean slope of a stretch in degrees, from its rise in metres and its
 * ground distance in km, sign ignored. NaN for a stretch with no length,
 * which has no slope; the chart draws such a stretch in plain ink.
 */
export function slopeDegrees(riseM: number, runKm: number): number {
  if (!(runKm > 0) || !Number.isFinite(riseM)) return Number.NaN
  return toDegrees(Math.atan(Math.abs(riseM) / (runKm * 1000)))
}

/** The band a slope falls in, or null when there is no slope (NaN). */
export function slopeBand(deg: number): SlopeBand | null {
  if (Number.isNaN(deg)) return null
  let band: SlopeBand = SLOPE_BANDS[0].band
  for (const b of SLOPE_BANDS) if (deg >= b.fromDeg) band = b.band
  return band
}

/** "3.2° gentle", for a readout: the band of the figure shown, so "5.0°" is never "gentle". */
export function describeSlope(deg: number): string | null {
  const shown = deg.toFixed(1)
  const band = slopeBand(Number(shown))
  return band === null ? null : `${shown}° ${band}`
}
