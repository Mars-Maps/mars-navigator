import { describe, expect, it } from 'vitest'
import {
  describeSlope,
  SLOPE_BANDS,
  SLOPE_METHOD,
  slopeBand,
  slopeDegrees,
} from '../../src/features/route-analysis/profileSlope'

describe('slopeDegrees', () => {
  it('is the angle of rise over run, uphill and downhill alike', () => {
    expect(slopeDegrees(0, 1)).toBe(0)
    expect(slopeDegrees(100, 1)).toBeCloseTo(5.71, 2)
    expect(slopeDegrees(-100, 1)).toBeCloseTo(5.71, 2)
    expect(slopeDegrees(1000, 1)).toBe(45)
    expect(slopeDegrees(268, 1)).toBeCloseTo(15.0, 1)
  })

  it('has no value for a stretch with no length or no finite rise', () => {
    expect(slopeDegrees(10, 0)).toBeNaN()
    expect(slopeDegrees(10, -1)).toBeNaN()
    expect(slopeDegrees(Number.NaN, 1)).toBeNaN()
  })
})

describe('slopeBand', () => {
  it('starts each band at its stated degree, the same on every route', () => {
    expect(SLOPE_BANDS.map((b) => b.fromDeg)).toEqual([0, 5, 15])
    expect(slopeBand(0)).toBe('gentle')
    expect(slopeBand(4.999)).toBe('gentle')
    expect(slopeBand(5)).toBe('moderate')
    expect(slopeBand(14.999)).toBe('moderate')
    expect(slopeBand(15)).toBe('steep')
    expect(slopeBand(45)).toBe('steep')
  })

  it('is null for no slope', () => {
    expect(slopeBand(Number.NaN)).toBeNull()
    expect(describeSlope(Number.NaN)).toBeNull()
  })

  it('describes a slope with one decimal and the band of the figure shown', () => {
    expect(describeSlope(3.21)).toBe('3.2° gentle')
    expect(describeSlope(slopeDegrees(1000, 1))).toBe('45.0° steep')
    // 4.96° shows as 5.0°, which the legend puts in moderate.
    expect(describeSlope(4.96)).toBe('5.0° moderate')
    expect(describeSlope(14.96)).toBe('15.0° steep')
  })

  it('says in its method what the bands are and that they are not an official limit', () => {
    expect(SLOPE_METHOD).toMatch(/under 5°/)
    expect(SLOPE_METHOD).toMatch(/5–15°/)
    expect(SLOPE_METHOD).toMatch(/15° and over/)
    expect(SLOPE_METHOD).toMatch(/Not an official limit/)
  })
})
