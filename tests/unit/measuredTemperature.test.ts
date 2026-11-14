import { describe, expect, it } from 'vitest'
import { MEDA_JEZERO_CITATION, type MedaExtract } from '../../src/data/temperature/medaJezero'
import {
  GALE_BOUNDS,
  GALE_BOUNDS_SOURCE,
  JEZERO_CRATER_BOUNDS,
  JEZERO_CRATER_BOUNDS_SOURCE,
  JEZERO_SITE_BOUNDS,
  MEDA_EXTREME_HOURS,
  measuredTemperatureLookup,
} from '../../src/data/temperature/measuredTemperature'
import { REMS_FEED_CITATION, type RemsSolRecord } from '../../src/data/temperature/remsGaleFeed'
import { JEZERO } from '../../src/data/sites/sites'
import { CELSIUS_OFFSET_K, insideBounds, official, unavailable, type MarsCoordinate } from '../../src/domain'

// Test fixtures only: one invented MEDA sol and one invented REMS sol.
const ALL = 0xffffff
const extract: MedaExtract = {
  solRange: [1858, 1859],
  builtOn: '2026-10-29',
  records: [
    { sol: 1858, dateUtc: '2026-05-12', solarLongitudeDeg: 138.31, min: { temperatureK: 192.06, uncertaintyK: 0.42, localTrueSolarHours: 6.18 }, max: { temperatureK: 246.13, uncertaintyK: 0.49, localTrueSolarHours: 13.39 }, hoursMask: ALL, samplesKept: 40642, samplesTotal: 45789 },
    { sol: 1859, dateUtc: '2026-05-13', solarLongitudeDeg: 137.3, min: { temperatureK: 187.99, uncertaintyK: 0.6, localTrueSolarHours: 23.56 }, max: { temperatureK: 259.97, uncertaintyK: 0.34, localTrueSolarHours: 13.5 }, hoursMask: ALL & ~(1 << 5), samplesKept: 43419, samplesTotal: 48510 },
  ],
}
const rems: RemsSolRecord[] = [
  { sol: 4994, dateUtc: '2026-08-24', solarLongitudeDeg: 340, minGroundC: -80, maxGroundC: 2 },
  { sol: 4995, dateUtc: '2026-08-25', solarLongitudeDeg: 341, minGroundC: -84, maxGroundC: null },
]
const PERSEVERANCE: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const CURIOSITY: MarsCoordinate = { latitude: -4.59, longitudeEast: 137.44 }
const ELSEWHERE: MarsCoordinate = { latitude: 0, longitudeEast: 0 }

const loaded = measuredTemperatureLookup({ jezero: official(extract, MEDA_JEZERO_CITATION), gale: official(rems, REMS_FEED_CITATION) })

describe('measuredTemperatureLookup', () => {
  it('answers inside Jezero and Gale only', () => {
    expect(loaded(ELSEWHERE)).toBeNull()
    expect(loaded({ latitude: 18.44, longitudeEast: 79 })).toBeNull()
    expect(loaded(PERSEVERANCE)?.classification).toBe('OFFICIAL')
    expect(loaded(CURIOSITY)?.classification).toBe('OFFICIAL')
    expect(insideBounds(PERSEVERANCE, JEZERO.bounds)).toBe(true)
    expect(insideBounds(CURIOSITY, GALE_BOUNDS)).toBe(true)
    expect(GALE_BOUNDS_SOURCE).toMatch(/Gazetteer.*2071.*checked 2026-10-29/)
  })

  it("at Jezero answers inside the crater's Gazetteer extent, as at Gale, and on the SIM 3464 sheet where the rover measures", () => {
    expect(JEZERO_CRATER_BOUNDS_SOURCE).toMatch(/Gazetteer.*14300.*checked 2026-11-10/)
    expect(JEZERO_SITE_BOUNDS).toEqual([JEZERO_CRATER_BOUNDS, JEZERO.bounds])
    expect(insideBounds(PERSEVERANCE, JEZERO_CRATER_BOUNDS)).toBe(true)
    // The crater's centre and its extent's corners answer; the extent's
    // east and north reach past the sheet (77.8°E, 18.7°N), which alone
    // missed them.
    expect(loaded({ latitude: 18.41, longitudeEast: 77.69 })?.classification).toBe('OFFICIAL')
    expect(loaded({ latitude: 18.01, longitudeEast: 77.27 })?.classification).toBe('OFFICIAL')
    expect(loaded({ latitude: 18.81, longitudeEast: 78.11 })?.classification).toBe('OFFICIAL')
    expect(insideBounds({ latitude: 18.81, longitudeEast: 78.11 }, JEZERO.bounds)).toBe(false)
    // Where the extract's latest sol (1859) was measured: on the rim west of
    // the crater's extent, on the sheet. The record must answer at the point
    // it was taken.
    const rover1859: MarsCoordinate = { latitude: 18.432, longitudeEast: 77.221 }
    expect(insideBounds(rover1859, JEZERO_CRATER_BOUNDS)).toBe(false)
    expect(loaded(rover1859)?.classification).toBe('OFFICIAL')
    // Outside both the extent and the sheet: nothing.
    expect(loaded({ latitude: 18.9, longitudeEast: 78.0 })).toBeNull()
    expect(loaded({ latitude: 17.6, longitudeEast: 77.69 })).toBeNull()
    expect(loaded({ latitude: 18.44, longitudeEast: 76.7 })).toBeNull()
  })

  it('at Jezero: the latest sol sampled through the extreme hours, each value cited to its sample', () => {
    const r = loaded(PERSEVERANCE)
    if (r?.classification !== 'OFFICIAL') throw new Error('expected OFFICIAL')
    expect(r.source).toBe(MEDA_JEZERO_CITATION)
    // Sol 1859 misses hour 5, so sol 1858 is shown.
    expect(r.value.sol).toBe(1858)
    expect(r.value.instrument).toBe('Perseverance MEDA TIRS')
    expect(r.value.site).toBe('Jezero crater')
    expect(r.value.dateUtc).toBe('2026-05-12')
    expect(r.value.solarLongitudeDeg).toBe(138.31)
    expect(r.value.minK).toMatchObject({ classification: 'OFFICIAL', value: 192.06 })
    expect(r.value.maxK).toMatchObject({ classification: 'OFFICIAL', value: 246.13 })
    if (r.value.minK.classification === 'OFFICIAL') expect(r.value.minK.source).toMatch(/sol 1858, minimum GROUND_TEMP 192\.06 ± 0\.42 K at 06:11/)
    expect(r.value.caveat).toMatch(/brightness temperature/)
    expect(r.value.caveat).toMatch(/40,642 of the sol’s 45,789 samples kept, in 24 of its 24 hours/)
    expect(MEDA_EXTREME_HOURS.every((h) => h >= 0 && h < 24)).toBe(true)
  })

  it('at Gale: the latest sol of the feed, °C turned to kelvin, a "--" field UNAVAILABLE and never 0', () => {
    const r = loaded(CURIOSITY)
    if (r?.classification !== 'OFFICIAL') throw new Error('expected OFFICIAL')
    expect(r.value.sol).toBe(4995)
    expect(r.value.instrument).toBe('Curiosity REMS GTS')
    expect(r.value.minK).toMatchObject({ classification: 'OFFICIAL', value: -84 + CELSIUS_OFFSET_K })
    if (r.value.minK.classification === 'OFFICIAL') expect(r.value.minK.source).toMatch(/sol 4995, minimum -84 °C as published/)
    expect(r.value.maxK.classification).toBe('UNAVAILABLE')
    if (r.value.maxK.classification === 'UNAVAILABLE') expect(r.value.maxK.reason).toMatch(/"--" for sol 4995’s maximum/)
    expect(r.value.caveat).toMatch(/outreach purposes only/)
  })

  it('says why while a source is loading, when it failed, and when no sol qualifies', () => {
    const loading = measuredTemperatureLookup({ jezero: null, gale: null })
    expect(loading(PERSEVERANCE)).toMatchObject({ classification: 'UNAVAILABLE', reason: 'Reading the Perseverance MEDA extract…' })
    expect(loading(CURIOSITY)).toMatchObject({ classification: 'UNAVAILABLE', reason: 'Reading the Curiosity REMS feed…' })
    expect(loading(ELSEWHERE)).toBeNull()
    const failed = measuredTemperatureLookup({ jezero: unavailable('extract broken'), gale: unavailable('feed down') })
    expect(failed(PERSEVERANCE)).toMatchObject({ classification: 'UNAVAILABLE', reason: 'extract broken' })
    expect(failed(CURIOSITY)).toMatchObject({ classification: 'UNAVAILABLE', reason: 'feed down' })
    const gaps = measuredTemperatureLookup({
      jezero: official({ ...extract, records: [extract.records[1]] }, MEDA_JEZERO_CITATION),
      gale: official([], REMS_FEED_CITATION),
    })
    expect(gaps(PERSEVERANCE)).toMatchObject({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/No sol in the Perseverance MEDA extract \(sols 1858–1859\)/) })
    expect(gaps(CURIOSITY)).toMatchObject({ classification: 'UNAVAILABLE', reason: 'Curiosity REMS feed lists no sols' })
  })
})
