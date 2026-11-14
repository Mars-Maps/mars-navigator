import { official, unavailable, type Classified } from '../../domain'

/**
 * Perseverance's MEDA ground temperature at Jezero: the committed
 * extract that `scripts/build-meda-extract.mjs` builds from the PDS
 * bundle, one row per sol, validated here before any number leaves it.
 *
 * The number is the calibrated TIRS product's GROUND_TEMP, "TIRS Ground
 * brightness temperature" in the product label's words, kelvin. It is the
 * thermal-infrared brightness of the ground in the sensor's band, not a
 * kinetic temperature corrected for emissivity, and the UI says so.
 */

export const MEDA_DOI = '10.17189/1522849'

export const MEDA_JEZERO_CITATION = `Perseverance MEDA Thermal Infrared Sensor (TIRS) ground brightness temperature: Rodriguez-Manfredi, J.A., and de la Torre Juárez, M., 2021, Mars 2020 MEDA Bundle, NASA Planetary Data System, doi ${MEDA_DOI}; collection data_calibrated_env, CAL_TIRS products, GROUND_TEMP (kelvin) with GROUND_TEMP_UNCERTAINTY; release 16 of 2026-08-11, sols 1–1859; read whole by scripts/build-meda-extract.mjs on 2026-10-29 and 30`

export const MEDA_CAVEAT =
  'A brightness temperature from TIRS’s downward-looking channel, in kelvin as archived, not a kinetic temperature corrected for the ground’s emissivity. The sol’s lowest and highest samples among those the product’s own flags allow: ground footprint not in shadow and rover tilt low. A sample the product marks as wheel-obstructed is dropped too, though that flag was blank on every row of the products inspected (sols 10 and 1859)'

export interface MedaSample {
  temperatureK: number
  /** The product's standard deviation for that sample, kelvin. */
  uncertaintyK: number
  /** Local true solar time of the sample, hours 0–24. */
  localTrueSolarHours: number
}

export interface MedaSolRecord {
  sol: number
  /** The UTC date at the sol's local mean noon. */
  dateUtc: string
  /** Ls at the product's first sample, the label's `start_solar_longitude`; null if a label lacked it. */
  solarLongitudeDeg: number | null
  /** The lowest kept sample, or null when the sol has none. */
  min: MedaSample | null
  max: MedaSample | null
  /** Bit h set when a kept sample falls in local true solar hour h. */
  hoursMask: number
  samplesKept: number
  samplesTotal: number
}

export interface MedaExtract {
  /** The sol range the extract covers, inclusive. */
  solRange: readonly [number, number]
  builtOn: string
  records: readonly MedaSolRecord[]
}

const COLUMNS = [
  'sol',
  'dateUtc',
  'solarLongitudeDeg',
  'minK',
  'minUncertaintyK',
  'minLocalTrueSolarHours',
  'maxK',
  'maxUncertaintyK',
  'maxLocalTrueSolarHours',
  'hoursMask',
  'samplesKept',
  'samplesTotal',
] as const

/** Ground brightness temperatures Mars can show, kelvin: wider than the extract (177–299 K over sols 1–1859). */
const KELVIN_RANGE = { min: 120, max: 340 }
const ALL_HOURS_MASK = 0xffffff

/**
 * The generated module's value as records, or what is wrong with it. One
 * bad row rejects the whole extract: it is generated, so a bad row means
 * the script or the source changed, and that must be noticed.
 */
export function parseMedaExtract(raw: unknown): MedaExtract | string {
  if (!isRecord(raw)) return 'not an object'
  if (!Array.isArray(raw.columns) || raw.columns.length !== COLUMNS.length || raw.columns.some((c, i) => c !== COLUMNS[i])) {
    return `columns are not ${COLUMNS.join(', ')}`
  }
  if (!isRecord(raw.provenance)) return 'no provenance'
  const { doi, builtOn, solRange } = raw.provenance
  if (doi !== MEDA_DOI) return `provenance doi is ${String(doi)}, not ${MEDA_DOI}`
  if (typeof builtOn !== 'string' || !isDate(builtOn)) return 'provenance builtOn is not a date'
  if (!Array.isArray(solRange) || solRange.length !== 2 || !solRange.every(isWhole)) return 'provenance solRange is not two sols'
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) return 'no rows'
  const records: MedaSolRecord[] = []
  let previousSol = -1
  for (const [i, row] of raw.rows.entries()) {
    const problem = (what: string) => `row ${i}: ${what}`
    if (!Array.isArray(row) || row.length !== COLUMNS.length) return problem(`not ${COLUMNS.length} columns`)
    const [sol, dateUtc, ls, minK, minU, minH, maxK, maxU, maxH, hoursMask, kept, total] = row as unknown[]
    if (!isWhole(sol) || sol <= previousSol) return problem('sol is not a whole number above the previous row’s')
    previousSol = sol
    if (typeof dateUtc !== 'string' || !isDate(dateUtc)) return problem('dateUtc is not YYYY-MM-DD')
    if (ls !== null && (typeof ls !== 'number' || ls < 0 || ls > 360)) return problem('solarLongitudeDeg is not 0–360 or null')
    const min = sample(minK, minU, minH)
    const max = sample(maxK, maxU, maxH)
    if (min === undefined) return problem('min is not a sample')
    if (max === undefined) return problem('max is not a sample')
    if ((min === null) !== (max === null)) return problem('min and max must both exist or both be null')
    if (min !== null && max !== null && min.temperatureK > max.temperatureK) return problem('min is above max')
    if (!isWhole(hoursMask) || hoursMask > ALL_HOURS_MASK) return problem('hoursMask is not 24 bits')
    if (!isWhole(kept) || !isWhole(total) || kept > total) return problem('sample counts are not whole numbers with kept ≤ total')
    if ((kept === 0) !== (min === null)) return problem('a sol with kept samples needs a min and max, and one without must have none')
    records.push({ sol, dateUtc, solarLongitudeDeg: ls, min, max, hoursMask, samplesKept: kept, samplesTotal: total })
  }
  const first = records[0].sol
  const last = records[records.length - 1].sol
  if (solRange[0] !== first || solRange[1] !== last) return `provenance solRange ${solRange.join('–')} is not the rows’ ${first}–${last}`
  return { solRange: [first, last], builtOn, records }
}

/** Whether every hour in `hours` has a kept sample. */
export function coversHours(hoursMask: number, hours: readonly number[]): boolean {
  return hours.every((h) => (hoursMask & (1 << h)) !== 0)
}

/**
 * The latest sol whose kept samples fall in every one of `hours`: the hours
 * a sol's minimum and maximum are expected in, so that a gap there cannot
 * hide the real extreme. Null when no sol qualifies.
 */
export function latestCoveredSol(records: readonly MedaSolRecord[], hours: readonly number[]): MedaSolRecord | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (r.min !== null && coversHours(r.hoursMask, hours)) return r
  }
  return null
}

/** The extract, loaded as its own chunk and validated: OFFICIAL with the citation, or UNAVAILABLE with the reason. */
export async function loadMedaJezero(): Promise<Classified<MedaExtract>> {
  let raw: unknown
  try {
    raw = (await import('./medaJezeroGroundTemperature')).MEDA_JEZERO_RAW
  } catch (error) {
    return unavailable(`Perseverance MEDA extract failed to load: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = parseMedaExtract(raw)
  if (typeof parsed === 'string') return unavailable(`Perseverance MEDA extract is not valid: ${parsed}`)
  return official(parsed, MEDA_JEZERO_CITATION)
}

function sample(k: unknown, u: unknown, h: unknown): MedaSample | null | undefined {
  if (k === null && u === null && h === null) return null
  if (typeof k !== 'number' || typeof u !== 'number' || typeof h !== 'number') return undefined
  if (k < KELVIN_RANGE.min || k > KELVIN_RANGE.max || u < 0 || h < 0 || h >= 24) return undefined
  return { temperatureK: k, uncertaintyK: u, localTrueSolarHours: h }
}

function isWhole(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
