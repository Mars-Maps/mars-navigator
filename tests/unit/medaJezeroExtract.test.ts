import { describe, expect, it } from 'vitest'
import { coversHours, loadMedaJezero, parseMedaExtract } from '../../src/data/temperature/medaJezero'
import { MEDA_JEZERO_RAW } from '../../src/data/temperature/medaJezeroGroundTemperature'
import { MEDA_EXTREME_HOURS } from '../../src/data/temperature/measuredTemperature'

/**
 * The committed extract itself: it is generated, so these are the
 * checks nobody can make by eye on 1,751 rows.
 */
describe('the committed MEDA Jezero extract', () => {
  const extract = parseMedaExtract(MEDA_JEZERO_RAW)
  if (typeof extract === 'string') throw new Error(extract)
  const sampled = extract.records.filter((r) => r.min !== null && r.max !== null)

  it('is valid, covers the mission so far, and loads OFFICIAL as its own chunk', async () => {
    expect(extract.solRange[0]).toBeGreaterThanOrEqual(1)
    expect(extract.solRange[1]).toBeGreaterThanOrEqual(1859)
    expect(extract.records.length).toBeGreaterThanOrEqual(1751)
    const loaded = await loadMedaJezero()
    expect(loaded.classification).toBe('OFFICIAL')
  })

  it('stays within what the ground at Jezero has shown, and a sol’s max is warmer than its min', () => {
    for (const r of sampled) {
      expect(r.min!.temperatureK).toBeGreaterThan(150)
      expect(r.max!.temperatureK).toBeLessThan(320)
      expect(r.max!.temperatureK).toBeGreaterThan(r.min!.temperatureK)
      expect(r.min!.uncertaintyK).toBeLessThan(5)
      expect(r.max!.uncertaintyK).toBeLessThan(5)
    }
  })

  it('MEDA_EXTREME_HOURS is where the extremes fall: on fully sampled sols, nearly every min and max lands in those hours', () => {
    const full = sampled.filter((r) => r.hoursMask === 0xffffff)
    expect(full.length).toBeGreaterThan(100)
    const cold = MEDA_EXTREME_HOURS.filter((h) => h < 12)
    const warm = MEDA_EXTREME_HOURS.filter((h) => h >= 12)
    const inHours = (hours: number, set: readonly number[]) => set.includes(Math.floor(hours))
    const minHit = full.filter((r) => inHours(r.min!.localTrueSolarHours, cold)).length / full.length
    const maxHit = full.filter((r) => inHours(r.max!.localTrueSolarHours, warm)).length / full.length
    expect(minHit).toBeGreaterThan(0.9)
    expect(maxHit).toBeGreaterThan(0.9)
    // And the sol the lookup shows is sampled through all of them.
    const latest = [...extract.records].reverse().find((r) => r.min !== null && coversHours(r.hoursMask, MEDA_EXTREME_HOURS))
    expect(latest).toBeDefined()
  })
})
