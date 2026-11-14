import {
  CELSIUS_OFFSET_K,
  insideBounds,
  official,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MeasuredGroundTemperature,
  type MeasuredTemperatureLookup,
  type SiteBounds,
} from '../../domain'
import { JEZERO } from '../sites/sites'
import { latestCoveredSol, MEDA_CAVEAT, MEDA_JEZERO_CITATION, type MedaExtract, type MedaSample } from './medaJezero'
import { latestRemsRecord, REMS_FEED_CAVEAT, REMS_FEED_CITATION, type RemsSolRecord } from './remsGaleFeed'

/**
 * Where a measured ground temperature exists: Perseverance's at
 * Jezero, Curiosity's at Gale. A point inside either site gets the latest
 * usable sol's record; any other point gets null, and the UI says that
 * measured values exist only at the two sites. Gale's extent is the
 * crater's; Jezero's is the crater's and the map sheet the rover drives on
 * (`JEZERO_SITE_BOUNDS`).
 */

/**
 * USGS Gazetteer of Planetary Nomenclature, feature 2071 "Gale" (crater),
 * checked 2026-10-29: westmost 136.40°E, eastmost 138.90°E, southmost
 * −6.62°, northmost −4.05°, planetocentric +East 0–360; diameter 155.30 km,
 * centre −5.44°, 137.70°E.
 */
export const GALE_BOUNDS: SiteBounds = { west: 136.4, east: 138.9, south: -6.62, north: -4.05 }
export const GALE_BOUNDS_SOURCE =
  'USGS Gazetteer of Planetary Nomenclature, feature 2071 "Gale": westmost 136.40°E, eastmost 138.90°E, southmost −6.62°, northmost −4.05° (planetocentric, +East 0–360), diameter 155.30 km; checked 2026-10-29'

/**
 * USGS Gazetteer of Planetary Nomenclature, feature 14300 "Jezero" (crater),
 * checked 2026-11-10: westmost 77.27°E, eastmost 78.11°E, southmost 18.01°,
 * northmost 18.81°, planetocentric +East 0–360; diameter 47.52 km, centre
 * 18.41°, 77.69°E. The crater's extent, as Gale's above: not
 * `JEZERO.bounds`, the SIM 3464 map sheet, which reaches onto Nili Planum.
 */
export const JEZERO_CRATER_BOUNDS: SiteBounds = { west: 77.27, east: 78.11, south: 18.01, north: 18.81 }
export const JEZERO_CRATER_BOUNDS_SOURCE =
  'USGS Gazetteer of Planetary Nomenclature, feature 14300 "Jezero": westmost 77.27°E, eastmost 78.11°E, southmost 18.01°, northmost 18.81° (planetocentric, +East 0–360), diameter 47.52 km; checked 2026-11-10'

/**
 * Where the Jezero record applies: inside the crater's Gazetteer
 * extent, as at Gale, or on the SIM 3464 map sheet (`JEZERO.bounds`,
 * "Jezero crater and the Nili Planum region"). The sheet stays because the
 * record is measured at the rover, and Perseverance has driven west of the
 * crater's extent since sol 1354 (December 2024, the rim climb): the
 * extract's latest sol, 1859, was measured at 18.432°N, 77.221°E, about
 * 3 km west of the extent's 77.27°E, and the rover stood at 77.233°E on sol
 * 2022 (Mars 2020 waypoint feed, read 2026-11-11). The crater's extent alone
 * would deny a measurement at the point it was taken. Curiosity has not
 * left Gale, so Gale's extent is the crater's only.
 */
export const JEZERO_SITE_BOUNDS: readonly SiteBounds[] = [JEZERO_CRATER_BOUNDS, JEZERO.bounds]

/**
 * Local true solar hours a sol's extremes fall in at Jezero, so a sol shown
 * as "min and max" was sampled where they happen: the ground is coldest
 * just before sunrise and warmest in the early afternoon. A project choice,
 * set from the extract itself: see the test that checks it against every
 * fully sampled sol.
 */
export const MEDA_EXTREME_HOURS: readonly number[] = [4, 5, 6, 12, 13, 14]

/** What the shell has read so far; null while a read is still in flight. */
export interface MeasuredTemperatureSources {
  jezero: Classified<MedaExtract> | null
  gale: Classified<RemsSolRecord[]> | null
}

export function measuredTemperatureLookup(sources: MeasuredTemperatureSources): MeasuredTemperatureLookup {
  const jezero = sources.jezero === null ? unavailable<MeasuredGroundTemperature>('Reading the Perseverance MEDA extract…') : jezeroRecord(sources.jezero)
  const gale = sources.gale === null ? unavailable<MeasuredGroundTemperature>('Reading the Curiosity REMS feed…') : galeRecord(sources.gale)
  return (point: MarsCoordinate) => {
    if (JEZERO_SITE_BOUNDS.some((b) => insideBounds(point, b))) return jezero
    if (insideBounds(point, GALE_BOUNDS)) return gale
    return null
  }
}

function jezeroRecord(extract: Classified<MedaExtract>): Classified<MeasuredGroundTemperature> {
  if (extract.classification === 'UNAVAILABLE') return extract
  const sol = latestCoveredSol(extract.value.records, MEDA_EXTREME_HOURS)
  if (sol === null || sol.min === null || sol.max === null) {
    return unavailable(
      `No sol in the Perseverance MEDA extract (sols ${extract.value.solRange[0]}–${extract.value.solRange[1]}) was sampled through the hours its minimum and maximum fall in`,
    )
  }
  const cite = (which: string, s: MedaSample) =>
    `${MEDA_JEZERO_CITATION} — sol ${sol.sol}, ${which} GROUND_TEMP ${s.temperatureK.toFixed(2)} ± ${s.uncertaintyK.toFixed(2)} K at ${formatHours(s.localTrueSolarHours)} local true solar time`
  return official(
    {
      site: JEZERO.name,
      instrument: 'Perseverance MEDA TIRS',
      sol: sol.sol,
      dateUtc: sol.dateUtc,
      solarLongitudeDeg: sol.solarLongitudeDeg,
      minK: official(sol.min.temperatureK, cite('minimum', sol.min)),
      maxK: official(sol.max.temperatureK, cite('maximum', sol.max)),
      caveat: `${MEDA_CAVEAT}. ${sol.samplesKept.toLocaleString('en-US')} of the sol’s ${sol.samplesTotal.toLocaleString('en-US')} samples kept, in ${countHours(sol.hoursMask)} of its 24 hours`,
    },
    MEDA_JEZERO_CITATION,
  )
}

function galeRecord(feed: Classified<RemsSolRecord[]>): Classified<MeasuredGroundTemperature> {
  if (feed.classification === 'UNAVAILABLE') return feed
  const latest = latestRemsRecord(feed.value)
  if (latest === null) return unavailable('Curiosity REMS feed lists no sols')
  const value = (which: string, c: number | null): Classified<number> =>
    c === null
      ? unavailable(`The feed gives "--" for sol ${latest.sol}’s ${which}: REMS reported no value`)
      : official(c + CELSIUS_OFFSET_K, `${REMS_FEED_CITATION} — sol ${latest.sol}, ${which} ${c} °C as published, + ${CELSIUS_OFFSET_K} for kelvin`)
  return official(
    {
      site: 'Gale crater',
      instrument: 'Curiosity REMS GTS',
      sol: latest.sol,
      dateUtc: latest.dateUtc,
      solarLongitudeDeg: latest.solarLongitudeDeg,
      minK: value('minimum', latest.minGroundC),
      maxK: value('maximum', latest.maxGroundC),
      caveat: REMS_FEED_CAVEAT,
    },
    REMS_FEED_CITATION,
  )
}

function countHours(mask: number): number {
  let n = 0
  for (let h = 0; h < 24; h++) if (mask & (1 << h)) n++
  return n
}

/** "05:52" from 5.87 hours. */
function formatHours(hours: number): string {
  const total = Math.round(hours * 60)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
