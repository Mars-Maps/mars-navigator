import { describe, expect, it } from 'vitest'
import { readFor, shieldingFromElevation, type PointRead } from '../../src/app/shielding'
import {
  derived,
  isShieldingWarning,
  official,
  SHIELDING_METHOD,
  shieldingWarningElevationM,
  unavailable,
} from '../../src/domain'

describe('shieldingFromElevation', () => {
  it("is 1 at Gale's height, DERIVED by the domain's method, naming the elevation's source", () => {
    const s = shieldingFromElevation(official(-4400, 'MOLA–HRSC blended DEM'))
    expect(s.classification).toBe('DERIVED')
    if (s.classification !== 'DERIVED') return
    expect(s.value).toBeCloseTo(1, 12)
    expect(s.method).toContain(SHIELDING_METHOD)
    expect(s.method).toContain('MOLA–HRSC blended DEM')
  })

  // A guard: point reads are OFFICIAL nearest cells today; blending is the surface grid's.
  it('names the method of a derived (blended) elevation as its source', () => {
    const s = shieldingFromElevation(derived(-2600, 'CTX 20 m blended into the global DEM'))
    expect(s.classification === 'DERIVED' && s.method).toContain('CTX 20 m blended into the global DEM')
  })

  it('warns above the line and not below it, the line from the domain', () => {
    const line = shieldingWarningElevationM()
    const above = shieldingFromElevation(official(line + 50, 'DEM'))
    const below = shieldingFromElevation(official(line - 50, 'DEM'))
    expect(above.classification === 'DERIVED' && isShieldingWarning(above.value)).toBe(true)
    expect(below.classification === 'DERIVED' && isShieldingWarning(below.value)).toBe(false)
  })

  it("keeps a missing elevation UNAVAILABLE with its reason, never Gale's 1", () => {
    const s = shieldingFromElevation(unavailable('No data at this cell'))
    expect(s).toEqual({ classification: 'UNAVAILABLE', reason: 'No elevation at this point: No data at this cell' })
  })

  it('is UNAVAILABLE for a non-finite elevation', () => {
    expect(shieldingFromElevation(official(Number.NaN, 'DEM')).classification).toBe('UNAVAILABLE')
    expect(shieldingFromElevation(official(Number.POSITIVE_INFINITY, 'DEM')).classification).toBe('UNAVAILABLE')
  })
})

describe('readFor', () => {
  const A = { latitude: 18.44, longitudeEast: 77.45 }
  const read: PointRead = { at: A, elevation: official(-2600, 'DEM'), shielding: derived(0.85, 'rule') }

  it('shows a read only for the selection it was made for', () => {
    expect(readFor(read, A)).toBe(read)
  })

  it("never shows a previous point's read under a new one, even at the same coordinate", () => {
    expect(readFor(read, { ...A })).toBeNull()
    expect(readFor(read, { latitude: -42.4, longitudeEast: 70.5 })).toBeNull()
  })

  it('shows nothing with no point or no read', () => {
    expect(readFor(read, null)).toBeNull()
    expect(readFor(null, A)).toBeNull()
  })
})
