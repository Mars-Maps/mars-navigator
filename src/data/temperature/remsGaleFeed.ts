import { official, unavailable, type Classified } from '../../domain'
import { defaultJsonIo, type JsonIo } from '../adapters/jsonIo'

/**
 * Curiosity's REMS ground temperature at Gale, read live from the
 * mars.nasa.gov weather feed. The feed is Centro de Astrobiología's
 * outreach copy of the REMS record, one row per sol since landing, and it
 * says so itself in its `descriptions.disclaimer_en`; the archive copy is
 * in the PDS. It is the only live source of a measured ground temperature
 * on Mars, so it is read as it is and labelled as what it is.
 *
 * Checked 2026-10-29: CORS `*`, 4745 sols from sol 1 (2012-08-07) to sol
 * 4995 (2026-08-25), `min_gts_temp` / `max_gts_temp` integer °C as strings,
 * "--" on 29 sols. The Perseverance feed (`category=mars2020`) stopped at
 * sol 1133 in April 2024 and is not used.
 */

export const REMS_FEED_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json&ver=1.0'

export const REMS_FEED_CITATION =
  'Curiosity REMS ground temperature sensor (GTS), Mars Science Laboratory weather feed at mars.nasa.gov (JSON, category msl), provided by Centro de Astrobiología (CAB) for outreach: min_gts_temp and max_gts_temp, integer °C per sol. Checked 2026-10-29: 4745 sols, latest sol 4995 (2026-08-25)'

/** What the feed's own disclaimer says, in its words where it matters. */
export const REMS_FEED_CAVEAT =
  'The mars.nasa.gov outreach feed, not the PDS archive: CAB states it is "intended for outreach purposes only". Measured at the rover, so its position, shade and dust deposits affect the values, and REMS does not measure continuously. Integer °C as published, converted to kelvin'

export interface RemsSolRecord {
  sol: number
  /** `terrestrial_date`: the Earth date of the sol at its midday, as the feed defines it. */
  dateUtc: string
  /** `ls`, an integer in the feed; null when it reads "--". */
  solarLongitudeDeg: number | null
  /** `min_gts_temp`, °C; null when the feed gives "--" (REMS reported no value). */
  minGroundC: number | null
  /** `max_gts_temp`, likewise. */
  maxGroundC: number | null
}

/** The feed's io: the adapters' one JSON fetch. */
export type RemsIo = JsonIo

/** Ground temperatures REMS could have printed, °C: wider than any sol so far (−136 to 25 on 2026-10-29). */
const GROUND_C_RANGE = { min: -150, max: 60 }

/**
 * The feed's rows as records, or what is wrong with the feed. One malformed
 * row rejects the whole answer: the shape is a contract, and a changed feed
 * must be noticed, not read around. A "--" or empty field is a missing
 * value, which the record carries as null.
 */
export function parseRemsFeed(body: unknown): RemsSolRecord[] | string {
  if (!isRecord(body)) return 'not a JSON object'
  const soles = body.soles
  if (!Array.isArray(soles)) return 'no "soles" list'
  if (soles.length === 0) return 'the "soles" list is empty'
  const records: RemsSolRecord[] = []
  for (const [i, row] of soles.entries()) {
    const problem = (what: string) => `row ${i}: ${what}`
    if (!isRecord(row)) return problem('not an object')
    const sol = integerField(row.sol)
    if (sol === null || sol < 0) return problem(`sol "${String(row.sol)}" is not a whole number`)
    const dateUtc = row.terrestrial_date
    if (typeof dateUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateUtc)) {
      return problem(`terrestrial_date "${String(dateUtc)}" is not YYYY-MM-DD`)
    }
    const solarLongitudeDeg = optionalNumber(row.ls)
    if (solarLongitudeDeg === undefined || (solarLongitudeDeg !== null && (solarLongitudeDeg < 0 || solarLongitudeDeg > 360))) {
      return problem(`ls "${String(row.ls)}" is not a solar longitude`)
    }
    const minGroundC = groundField(row.min_gts_temp)
    if (minGroundC === undefined) return problem(`min_gts_temp "${String(row.min_gts_temp)}" is not a ground temperature`)
    const maxGroundC = groundField(row.max_gts_temp)
    if (maxGroundC === undefined) return problem(`max_gts_temp "${String(row.max_gts_temp)}" is not a ground temperature`)
    if (minGroundC !== null && maxGroundC !== null && minGroundC > maxGroundC) {
      return problem(`min_gts_temp ${minGroundC} is above max_gts_temp ${maxGroundC}`)
    }
    records.push({ sol, dateUtc, solarLongitudeDeg, minGroundC, maxGroundC })
  }
  return records
}

/** The feed, read once: OFFICIAL with the citation, or UNAVAILABLE with the reason. Never rejects. */
export async function loadRemsFeed(signal: AbortSignal, io: RemsIo = defaultJsonIo): Promise<Classified<RemsSolRecord[]>> {
  if (signal.aborted) return unavailable('Curiosity REMS feed: cancelled')
  let body: unknown
  try {
    body = await io.fetchJson(REMS_FEED_URL, signal)
  } catch (error) {
    return unavailable(`Curiosity REMS feed failed to load: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = parseRemsFeed(body)
  if (typeof parsed === 'string') return unavailable(`Curiosity REMS feed failed to load: ${parsed}`)
  return official(parsed, REMS_FEED_CITATION)
}

/** The highest-numbered sol, whatever order the feed lists them in; null for no records. */
export function latestRemsRecord(records: readonly RemsSolRecord[]): RemsSolRecord | null {
  let latest: RemsSolRecord | null = null
  for (const r of records) if (latest === null || r.sol > latest.sol) latest = r
  return latest
}

/** A ground temperature field: a number in range, null for "--" or empty, undefined for anything else. */
function groundField(v: unknown): number | null | undefined {
  const n = optionalNumber(v)
  if (n === null || n === undefined) return n
  return n >= GROUND_C_RANGE.min && n <= GROUND_C_RANGE.max ? n : undefined
}

/** A numeric string field: its number, null when it is "--" or empty, undefined when it is not a number. */
function optionalNumber(v: unknown): number | null | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (s === '' || s === '--') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

function integerField(v: unknown): number | null {
  const n = optionalNumber(v)
  return typeof n === 'number' && Number.isInteger(n) ? n : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
