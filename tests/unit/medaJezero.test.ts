import { describe, expect, it } from 'vitest'
import {
  coversHours,
  latestCoveredSol,
  MEDA_CAVEAT,
  MEDA_DOI,
  MEDA_JEZERO_CITATION,
  parseMedaExtract,
  type MedaSolRecord,
} from '../../src/data/temperature/medaJezero'

// Test fixture only: the generated module's shape with invented rows.
const COLUMNS = [
  'sol', 'dateUtc', 'solarLongitudeDeg', 'minK', 'minUncertaintyK', 'minLocalTrueSolarHours',
  'maxK', 'maxUncertaintyK', 'maxLocalTrueSolarHours', 'hoursMask', 'samplesKept', 'samplesTotal',
]
const ALL = 0xffffff
const rows = [
  [10, '2021-03-01', 113.27, null, null, null, null, null, null, 0, 0, 2503],
  [1858, '2026-05-12', 138.31, 192.06, 0.42, 6.18, 246.13, 0.49, 13.39, ALL & ~(1 << 5), 40642, 45789],
  [1859, '2026-05-13', 137.3, 187.99, 0.6, 23.56, 259.97, 0.34, 13.5, ALL, 43419, 48510],
]
const raw = (patch: Record<string, unknown> = {}, rowsIn: unknown[] = rows) => ({
  provenance: { doi: MEDA_DOI, builtOn: '2026-10-29', solRange: [10, 1859] },
  columns: COLUMNS,
  rows: rowsIn,
  ...patch,
})

describe('parseMedaExtract', () => {
  it('turns the rows into records, a sol with no kept samples having no min or max', () => {
    const extract = parseMedaExtract(raw())
    expect(typeof extract).not.toBe('string')
    if (typeof extract === 'string') return
    expect(extract.solRange).toEqual([10, 1859])
    expect(extract.builtOn).toBe('2026-10-29')
    expect(extract.records).toHaveLength(3)
    expect(extract.records[0]).toEqual({
      sol: 10, dateUtc: '2021-03-01', solarLongitudeDeg: 113.27, min: null, max: null, hoursMask: 0, samplesKept: 0, samplesTotal: 2503,
    })
    expect(extract.records[2].min).toEqual({ temperatureK: 187.99, uncertaintyK: 0.6, localTrueSolarHours: 23.56 })
    expect(extract.records[2].max).toEqual({ temperatureK: 259.97, uncertaintyK: 0.34, localTrueSolarHours: 13.5 })
  })

  it('rejects the whole extract, naming the row, for anything out of shape or range', () => {
    const problem = (patch: Record<string, unknown> = {}, rowsIn: unknown[] = rows) => parseMedaExtract(raw(patch, rowsIn))
    expect(problem({ columns: COLUMNS.slice(1) })).toMatch(/^columns are not/)
    expect(problem({ provenance: { doi: 'x', builtOn: '2026-10-29', solRange: [10, 1859] } })).toMatch(/doi is x/)
    expect(problem({ provenance: { doi: MEDA_DOI, builtOn: '2026-10-29', solRange: [10, 1858] } })).toMatch(/solRange 10–1858 is not the rows’ 10–1859/)
    expect(problem({}, [])).toBe('no rows')
    expect(problem({}, [rows[0], rows[0]])).toMatch(/row 1: sol/)
    expect(problem({}, [[...rows[2].slice(0, 11)]])).toMatch(/not 12 columns/)
    expect(problem({}, [[1859, '13/05/2026', ...rows[2].slice(2)]])).toMatch(/dateUtc/)
    expect(problem({}, [[1859, '2026-05-13', 361, ...rows[2].slice(3)]])).toMatch(/solarLongitudeDeg/)
    expect(problem({}, [[1859, '2026-05-13', 137.3, 50, 0.6, 23.56, ...rows[2].slice(6)]])).toMatch(/min is not a sample/)
    expect(problem({}, [[1859, '2026-05-13', 137.3, 260, 0.6, 23.56, 200, 0.34, 13.5, ALL, 1, 1]])).toMatch(/min is above max/)
    expect(problem({}, [[1859, '2026-05-13', 137.3, null, null, null, 200, 0.34, 13.5, ALL, 1, 1]])).toMatch(/both exist or both be null/)
    expect(problem({}, [[1859, '2026-05-13', 137.3, ...rows[2].slice(3, 9), ALL + 1, 1, 1]])).toMatch(/hoursMask/)
    expect(problem({}, [[1859, '2026-05-13', 137.3, ...rows[2].slice(3, 9), ALL, 5, 1]])).toMatch(/kept ≤ total/)
    expect(problem({}, [[1859, '2026-05-13', 137.3, ...rows[2].slice(3, 9), ALL, 0, 1]])).toMatch(/kept samples needs a min and max/)
    expect(parseMedaExtract(null)).toBe('not an object')
  })

  it('cites the bundle by DOI and says brightness, not kinetic', () => {
    expect(MEDA_JEZERO_CITATION).toMatch(/10\.17189\/1522849/)
    expect(MEDA_JEZERO_CITATION).toMatch(/CAL_TIRS/)
    expect(MEDA_JEZERO_CITATION).toMatch(/2026-10-29/)
    expect(MEDA_CAVEAT).toMatch(/brightness temperature/)
    expect(MEDA_CAVEAT).toMatch(/not a kinetic/)
  })
})

describe('latestCoveredSol', () => {
  const records = (parseMedaExtract(raw()) as { records: readonly MedaSolRecord[] }).records

  it('covers hours by bit', () => {
    expect(coversHours(ALL, [0, 5, 23])).toBe(true)
    expect(coversHours(ALL & ~(1 << 5), [4, 5, 6])).toBe(false)
    expect(coversHours(0, [])).toBe(true)
  })

  it('takes the latest sol sampled through the given hours, skipping one with a gap there or no samples', () => {
    expect(latestCoveredSol(records, [5, 13])?.sol).toBe(1859)
    expect(latestCoveredSol(records.slice(0, 2), [5, 13])?.sol).toBeUndefined()
    expect(latestCoveredSol(records.slice(0, 2), [4, 6])?.sol).toBe(1858)
    expect(latestCoveredSol(records.slice(0, 1), [])).toBeNull()
  })
})
