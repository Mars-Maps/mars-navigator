import { describe, expect, it } from 'vitest'
import { pressureFromElevation, TES_GRIDS_FAILED_REASON } from '../../src/app/useTemperatureModel'
import { derived, official, unavailable } from '../../src/domain'
import { surfacePressurePa } from '../../src/features/route-analysis/thermalModel'

describe('pressureFromElevation', () => {
  it('derives the pressure from an OFFICIAL height, naming its source', () => {
    const p = pressureFromElevation(official(-2569, 'CTX model'))
    expect(p.classification).toBe('DERIVED')
    if (p.classification !== 'DERIVED') return
    expect(p.value).toBeCloseTo(surfacePressurePa(-2569), 9)
    expect(p.method).toBe('elevation −2569 m here: CTX model')
  })

  it("names a blended height's method as its source", () => {
    const p = pressureFromElevation(derived(100, 'blend'))
    expect(p.classification === 'DERIVED' && p.method).toContain('blend')
  })

  it('keeps a missing height UNAVAILABLE with its reason, never the mean pressure', () => {
    expect(pressureFromElevation(unavailable('No data'))).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'No elevation at this point: No data',
    })
  })
})

describe('TES_GRIDS_FAILED_REASON', () => {
  it('names the grids and carries the failure, an Error or anything else', () => {
    expect(TES_GRIDS_FAILED_REASON(new Error('Failed to fetch dynamically imported module'))).toBe(
      'The TES thermal inertia and albedo grids could not be loaded: Failed to fetch dynamically imported module',
    )
    expect(TES_GRIDS_FAILED_REASON('offline')).toMatch(/could not be loaded: offline$/)
  })
})
