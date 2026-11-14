import { describe, expect, it } from 'vitest'
import {
  J_PER_KCAL,
  LEVEL_COST_J_PER_KG_M,
  METABOLIC_COST_METHOD,
  MINETTI_GRADIENT_RANGE,
  MINETTI_SOURCE,
  REFERENCE_MASS,
  leastWalkingCostJPerKgM,
  leastWalkingKcalPerKm,
  walkingCostJPerKgM,
  walkingKcalPerKm,
} from '../../src/features/route-analysis/metabolicCost'

describe('metabolic cost of walking (Minetti et al. 2002)', () => {
  it("reproduces the study's figures at the ends of its range and on the level", () => {
    // The abstract: 17.33 ± 1.11 J/kg/m at +0.45, 3.46 ± 0.95 at −0.45; the fit's level value is 2.5.
    expect(walkingCostJPerKgM(0.45)).toBeCloseTo(17.33, 0)
    expect(walkingCostJPerKgM(-0.45)).toBeCloseTo(3.46, 0)
    expect(LEVEL_COST_J_PER_KG_M).toBe(2.5)
  })

  it('is cheapest on a gentle descent and never free or negative', () => {
    expect(walkingCostJPerKgM(-0.1)).toBeLessThan(walkingCostJPerKgM(0))
    let least = Number.POSITIVE_INFINITY
    for (let s = -0.45; s <= 0.45; s += 0.001) least = Math.min(least, walkingCostJPerKgM(s))
    expect(least).toBeGreaterThan(0.8)
    expect(least).toBeLessThan(1)
    // The scanned minimum the shown text quotes: at the curve's own low point, not a chosen gradient.
    expect(leastWalkingCostJPerKgM(MINETTI_GRADIENT_RANGE)).toBeLessThanOrEqual(least)
    expect(leastWalkingCostJPerKgM(MINETTI_GRADIENT_RANGE)).toBeLessThan(walkingCostJPerKgM(-0.15))
    expect(leastWalkingCostJPerKgM(MINETTI_GRADIENT_RANGE)).toBeCloseTo(0.9355, 3)
    // The abstract's 0.81 at −0.10 is the study's minimum over speeds; the fit sits above it there.
    expect(walkingCostJPerKgM(-0.1)).toBeGreaterThan(0.81)
    expect(walkingCostJPerKgM(-0.1)).toBeLessThan(1.3)
  })

  it('climbs steeply uphill, more than threefold by a 20° slope', () => {
    const twenty = Math.tan((20 * Math.PI) / 180)
    expect(walkingCostJPerKgM(twenty) / walkingCostJPerKgM(0)).toBeGreaterThan(3)
    expect(walkingCostJPerKgM(0.2)).toBeGreaterThan(walkingCostJPerKgM(0.1))
  })

  it('costs ground beyond the measured range at its edge rather than extrapolating', () => {
    expect(walkingCostJPerKgM(0.9)).toBe(walkingCostJPerKgM(MINETTI_GRADIENT_RANGE))
    expect(walkingCostJPerKgM(-0.9)).toBe(walkingCostJPerKgM(-MINETTI_GRADIENT_RANGE))
  })

  it('prices a kilometre for the reference mass: about 46 kcal on the level', () => {
    expect(REFERENCE_MASS.kg).toBeCloseTo((42.64 + 110.22) / 2, 2)
    expect(walkingKcalPerKm(0)).toBeCloseTo((2.5 * REFERENCE_MASS.kg * 1000) / J_PER_KCAL, 6)
    expect(walkingKcalPerKm(0)).toBeCloseTo(45.7, 0)
  })

  it('gives a lower bound no walkable step beats, for the search heuristic', () => {
    const limit = Math.tan((20 * Math.PI) / 180)
    const least = leastWalkingKcalPerKm(limit)
    // A grid of its own, off the bound's scan points, so the margin is what keeps the bound under every step.
    for (let s = -limit; s <= limit; s += 0.00011) expect(walkingKcalPerKm(s)).toBeGreaterThan(least)
    expect(least).toBeLessThan(walkingKcalPerKm(0))
  })

  it('cites the study, the mass and what is not corrected for', () => {
    expect(MINETTI_SOURCE).toMatch(/Minetti.*2002.*J Appl Physiol 93:1039–1046.*doi 10\.1152\/japplphysiol\.01177\.2001/)
    expect(MINETTI_SOURCE).toMatch(/Earth gravity, unsuited/)
    expect(REFERENCE_MASS.source).toMatch(/NASA-STD-3001 Vol\. 2 \(42\.64–110\.22 kg; Appendix E, Table E\.5-1 of the online edition read 2026-11-03, Table 45 in the Rev C PDF, Table E\.6\.1 in the Rev F PDF\)/)
    expect(METABOLIC_COST_METHOD).toMatch(/76\.43 kg/)
    expect(METABOLIC_COST_METHOD).toMatch(/no published correction for a pressure suit or for Mars gravity is applied/)
    expect(METABOLIC_COST_METHOD).toMatch(/never below 0\.9 J\/kg\/m downhill/)
    expect(METABOLIC_COST_METHOD).not.toMatch(/fitted speed/)
    expect(METABOLIC_COST_METHOD).toMatch(/least measured level cost is 1\.64 ± 0\.50 J\/kg\/m at 1\.0 ± 0\.3 m\/s, so on Earth the fit sits above the study's measured level minimum; for a suited walker at Mars gravity even the direction of the error is not known, and the speed behind the fit is not stated in the sources read/)
    expect(METABOLIC_COST_METHOD).not.toMatch(/leans high/)
    expect(METABOLIC_COST_METHOD).toMatch(/not at the pace the duration assumes/)
    expect(REFERENCE_MASS.source).toMatch(/^a project choice: /)
  })
})
