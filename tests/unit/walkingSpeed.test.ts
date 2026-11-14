import { describe, expect, it } from 'vitest'
import {
  SUITED_LEVEL_PACE,
  SUITED_MAX_KMH,
  TOBLER_LEVEL_KMH,
  TOBLER_SOURCE,
  WALKING_SPEED_METHOD,
  suitedWalkingKmh,
  toblerKmh,
} from '../../src/features/route-analysis/walkingSpeed'

const deg = (d: number) => Math.tan((d * Math.PI) / 180)

describe("Tobler's hiking function", () => {
  it('is 6 km/h at its best, on a gradient of −0.05, and about 5 km/h on the level', () => {
    expect(toblerKmh(-0.05)).toBeCloseTo(6, 12)
    expect(toblerKmh(0)).toBeCloseTo(6 * Math.exp(-0.175), 12)
    expect(TOBLER_LEVEL_KMH).toBeCloseTo(5.04, 2)
  })

  it('falls off symmetrically about −0.05, so a climb and a steeper descent cost alike', () => {
    expect(toblerKmh(0.1)).toBeCloseTo(toblerKmh(-0.2), 12)
    expect(toblerKmh(deg(20))).toBeLessThan(toblerKmh(deg(-20)))
    expect(toblerKmh(deg(20))).toBeLessThan(toblerKmh(0))
  })

  it('cites the report, its formula and the Imhof data, and says the hikers were on Earth', () => {
    expect(TOBLER_SOURCE).toMatch(/Tobler, W\. \(1993\)/)
    expect(TOBLER_SOURCE).toMatch(/93-1/)
    expect(TOBLER_SOURCE).toMatch(/6·e\^\(−3\.5·\|S \+ 0\.05\|\)/)
    expect(TOBLER_SOURCE).toMatch(/Imhof \(1950/)
    expect(TOBLER_SOURCE).toMatch(/Earth/)
  })
})

describe('suited walking speed', () => {
  it("walks level ground at NASA's planning pace, 2 km/h, from EVA-EXP-0075", () => {
    expect(suitedWalkingKmh(0)).toBeCloseTo(SUITED_LEVEL_PACE.kmh, 12)
    expect(SUITED_LEVEL_PACE.kmh).toBe(2)
    expect(SUITED_LEVEL_PACE.source).toMatch(/EVA-EXP-0075/)
    expect(SUITED_LEVEL_PACE.source).toMatch(/2 km\/hr/)
    expect(SUITED_LEVEL_PACE.source).toMatch(/Does not account for slope or obstacles/)
  })

  it("keeps Tobler's shape: the fastest pace is on the slight descent, about 2.4 km/h", () => {
    expect(SUITED_MAX_KMH).toBeCloseTo((2 * 6) / TOBLER_LEVEL_KMH, 12)
    expect(SUITED_MAX_KMH).toBeCloseTo(2.38, 2)
    for (const s of [-0.5, -0.2, -0.1, 0, 0.1, 0.2, 0.5]) {
      expect(suitedWalkingKmh(s)).toBeLessThanOrEqual(SUITED_MAX_KMH + 1e-12)
      expect(suitedWalkingKmh(s)).toBeGreaterThan(0)
    }
  })

  it('states the derivation and that neither source is a Mars measurement', () => {
    expect(WALKING_SPEED_METHOD).toMatch(/Tobler/)
    expect(WALKING_SPEED_METHOD).toMatch(/EVA-EXP-0075/)
    expect(WALKING_SPEED_METHOD).toMatch(/2 km\/h/)
    expect(WALKING_SPEED_METHOD).toMatch(/not a Mars measurement/)
  })
})
