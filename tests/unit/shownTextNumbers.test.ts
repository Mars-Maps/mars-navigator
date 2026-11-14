import { describe, expect, it } from 'vitest'
import { isAvailable } from '../../src/domain'
import { NO_SHIELDING_REASON } from '../../src/features/mission-ui/radiation/radiationMath'
import { SCIENCE_GOALS } from '../../src/features/route-analysis/scienceGoals'
import { scientific } from '../../src/features/route-analysis/strategies/scientific'
import { TEMPERATURE_LAYER_PENDING_METHOD } from '../../src/features/route-analysis/temperatureLayer'
import { VALIDATED_ERROR } from '../../src/features/route-analysis/temperatureModel'

/**
 * Texts the app shows as they are, in marks, tooltips and method lines:
 * a reader cannot look up a tracker reference, so none belongs in them. The methods built
 * per route or walk are checked in hazards, walkLegs and temperatureLayer
 * tests.
 */
const NUMBERED = /#\d/

describe('shown texts cite no tracker number', () => {
  it('the science goals’ method', () => {
    for (const goal of SCIENCE_GOALS) {
      expect(isAvailable(goal.reason) && goal.reason.classification === 'DERIVED' && goal.reason.method).not.toMatch(NUMBERED)
      // The citation it rests on stays whole.
      expect(goal.reason.classification === 'DERIVED' && goal.reason.method).toContain('Scientific Investigations Map 3464')
    }
  })

  it('the Scientific route’s requirements', () => {
    for (const need of scientific.requires) expect(need).not.toMatch(NUMBERED)
  })

  it('the thermal layer before its runs, and the temperature error bound', () => {
    expect(TEMPERATURE_LAYER_PENDING_METHOD).toMatch(/^Model estimate, not a measurement/)
    expect(TEMPERATURE_LAYER_PENDING_METHOD).not.toMatch(NUMBERED)
    expect(VALIDATED_ERROR.basis).not.toMatch(NUMBERED)
    // The measured figures it rests on stay.
    expect(VALIDATED_ERROR.basis).toContain('7.2 K rms')
    expect(VALIDATED_ERROR.basis).toContain('9.3 K rms')
  })

  it('the radiation line while a point’s height is read', () => {
    expect(NO_SHIELDING_REASON).not.toMatch(NUMBERED)
    expect(NO_SHIELDING_REASON).toContain('derived from the elevation against Gale')
  })
})
