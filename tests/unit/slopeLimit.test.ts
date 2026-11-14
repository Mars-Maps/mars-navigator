import { describe, expect, it } from 'vitest'
import { RADIATION_HAZARD_UNIT, derived, simulated, unavailable, type Classified, type Hazard, type SlopeLimit } from '../../src/domain'
import { formatSlope, isOverLimit, legSlopeToFlag, shownSlope } from '../../src/features/mission-ui/slopeLimit'

// Test fixtures only — invented slopes, hazards and limit, never shown in the app.
const LIMIT: SlopeLimit = { deg: 20, label: 'fixture-limit-label', source: 'fixture-citation' }
const AT = { latitude: 0, longitudeEast: 0 }
const slopeHazard = (id: string, magnitude: Classified<number>): Hazard => ({ id, kind: 'slope', unit: '°', coordinate: AT, magnitude })
const PART_CHECKED = unavailable<number>('fixture-part-not-checked')

describe('legSlopeToFlag', () => {
  it('keeps the leg’s steepest slope when the planner knows it', () => {
    const steepest = derived(12, 'fixture-steepest')
    expect(legSlopeToFlag(steepest, derived([slopeHazard('a', derived(25, 'fixture'))], 'fixture-scan'))).toBe(steepest)
  })

  it('flags a part-checked leg on its steepest measured stretch over the limit', () => {
    const hazards = derived(
      [
        slopeHazard('a', derived(22, 'fixture-a')),
        slopeHazard('b', unavailable('fixture-b-not-checked')),
        slopeHazard('c', derived(28.4, 'fixture-c')),
        { id: 'r', kind: 'radiation', unit: RADIATION_HAZARD_UNIT, coordinate: AT, magnitude: derived(40, 'fixture-r') },
      ] satisfies Hazard[],
      'fixture-scan',
    )
    const flagged = legSlopeToFlag(PART_CHECKED, hazards)
    expect(flagged).toEqual(derived(28.4, 'fixture-c'))
    expect(isOverLimit(flagged, LIMIT)).toBe(true)
  })

  it('stays unknown, never flagged, when no stretch has a figure or the leg was not scanned', () => {
    const unchecked = derived([slopeHazard('a', unavailable('fixture-a-not-checked'))], 'fixture-scan')
    expect(legSlopeToFlag(PART_CHECKED, unchecked)).toBe(PART_CHECKED)
    expect(legSlopeToFlag(PART_CHECKED, derived([], 'fixture-scan'))).toBe(PART_CHECKED)
    expect(legSlopeToFlag(PART_CHECKED, unavailable('fixture-not-scanned'))).toBe(PART_CHECKED)
    expect(isOverLimit(legSlopeToFlag(PART_CHECKED, unchecked), LIMIT)).toBe(false)
  })

  it('ignores a stretch whose figure is not a slope', () => {
    const hazards = derived([slopeHazard('a', derived(Number.NaN, 'fixture-nan'))], 'fixture-scan')
    expect(legSlopeToFlag(PART_CHECKED, hazards)).toBe(PART_CHECKED)
  })
})

describe('shownSlope', () => {
  it('passes a slope through, and makes a negative or non-finite one UNAVAILABLE', () => {
    expect(shownSlope(derived(0, 'fixture'))).toEqual(derived(0, 'fixture'))
    expect(shownSlope(unavailable('fixture-gap'))).toEqual(unavailable('fixture-gap'))
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shownSlope(derived(bad, 'fixture')).classification).toBe('UNAVAILABLE')
    }
  })
})

describe('isOverLimit', () => {
  it('flags only a slope strictly over the limit, never an unknown one', () => {
    expect(isOverLimit(derived(20, 'fixture'), LIMIT)).toBe(false)
    expect(isOverLimit(derived(20.01, 'fixture'), LIMIT)).toBe(true)
    expect(isOverLimit(simulated(31, 'fixture'), LIMIT)).toBe(true)
    expect(isOverLimit(unavailable('fixture-gap'), LIMIT)).toBe(false)
    expect(isOverLimit(derived(Number.NaN, 'fixture'), LIMIT)).toBe(false)
    expect(isOverLimit(derived(Number.POSITIVE_INFINITY, 'fixture'), LIMIT)).toBe(false)
  })
})

describe('formatSlope', () => {
  it('reads in the elevation chart’s bands', () => {
    expect(formatSlope(3.24)).toBe('3.2° gentle')
    expect(formatSlope(12.4)).toBe('12.4° moderate')
    expect(formatSlope(23.4)).toBe('23.4° steep')
  })
})
