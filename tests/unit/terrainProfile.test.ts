import { describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import {
  TERRAIN_PROFILE_REASONS,
  terrainProfileState,
} from '../../src/features/route-analysis/terrainProfile'

/** Builds corners from [latitude, longitudeEast] pairs. Test fixture only. */
function flags(...coords: [number, number][]): MarsCoordinate[] {
  return coords.map(([latitude, longitudeEast]) => ({ latitude, longitudeEast }))
}

const reasonOf = (f: MarsCoordinate[]) => {
  const state = terrainProfileState(f)
  return state.status === 'ready' ? null : state.reason
}

describe('terrainProfileState: fewer than four corners', () => {
  it.each([0, 1, 2, 3])('is disabled with %i corners, with a reason and how many are left', (n) => {
    const all = flags([0, 10], [0, 11], [1, 11], [1, 10])
    expect(terrainProfileState(all.slice(0, n))).toEqual({
      status: 'disabled',
      reason: TERRAIN_PROFILE_REASONS.needsCorners,
      cornersNeeded: 4 - n,
    })
  })
})

describe('terrainProfileState: four corners', () => {
  it('is ready for a square, keeping the corners in the order set', () => {
    const square = flags([0, 10], [0, 11], [1, 11], [1, 10])
    expect(terrainProfileState(square)).toEqual({ status: 'ready', request: { corners: square } })
  })

  it('accepts either winding', () => {
    expect(terrainProfileState(flags([1, 10], [1, 11], [0, 11], [0, 10])).status).toBe('ready')
  })

  it('accepts a concave region', () => {
    // An arrowhead: the third corner points back inside.
    expect(terrainProfileState(flags([0, 10], [2, 11], [0.5, 11], [0, 12])).status).toBe('ready')
  })

  it('accepts a region across 0°E', () => {
    expect(terrainProfileState(flags([0, 359.5], [0, 0.5], [1, 0.5], [1, 359.5])).status).toBe(
      'ready',
    )
  })

  it('accepts a region around a pole', () => {
    expect(terrainProfileState(flags([85, 0], [85, 90], [85, 180], [85, 270])).status).toBe('ready')
  })

  it('accepts corners a few metres apart, not lost to float error', () => {
    const d = 1e-4 // about 6 m on Mars
    const tiny = flags([4.5, 137.4], [4.5, 137.4 + d], [4.5 + d, 137.4 + d], [4.5 + d, 137.4])
    expect(terrainProfileState(tiny).status).toBe('ready')
  })
})

describe('terrainProfileState: rejected', () => {
  it('rejects a fifth corner', () => {
    expect(reasonOf(flags([0, 10], [0, 11], [1, 11], [1, 10], [0.5, 10.5]))).toBe(
      TERRAIN_PROFILE_REASONS.tooManyCorners,
    )
  })

  it('rejects an invalid coordinate', () => {
    expect(reasonOf(flags([0, 10], [0, 11], [1, 360], [1, 10]))).toBe(
      TERRAIN_PROFILE_REASONS.invalidCoordinate,
    )
    expect(reasonOf(flags([0, 10], [0, 11], [Number.NaN, 11], [1, 10]))).toBe(
      TERRAIN_PROFILE_REASONS.invalidCoordinate,
    )
  })

  it.each([
    ['neighbouring', flags([0, 10], [0, 10], [1, 11], [1, 10])],
    ['diagonal', flags([0, 10], [0, 11], [0, 10], [1, 10])],
    ['first and last', flags([0, 10], [0, 11], [1, 11], [0, 10])],
    ['all four', flags([0, 10], [0, 10], [0, 10], [0, 10])],
    ['at the pole, different longitudes', flags([90, 0], [80, 0], [80, 90], [90, 120])],
  ])('rejects duplicate corners: %s', (_label, f) => {
    expect(reasonOf(f)).toBe(TERRAIN_PROFILE_REASONS.duplicate)
  })

  it('rejects three corners in a row on one great circle', () => {
    expect(reasonOf(flags([0, 10], [0, 11], [0, 12], [1, 11]))).toBe(
      TERRAIN_PROFILE_REASONS.collinear,
    )
  })

  it('rejects four corners on one meridian: no area', () => {
    expect(reasonOf(flags([0, 10], [1, 10], [2, 10], [3, 10]))).toBe(
      TERRAIN_PROFILE_REASONS.collinear,
    )
  })

  it('rejects a bow tie, whose edges cross', () => {
    expect(reasonOf(flags([0, 10], [1, 11], [0, 11], [1, 10]))).toBe(
      TERRAIN_PROFILE_REASONS.selfIntersecting,
    )
  })

  it('rejects corners spread over too much of the globe', () => {
    expect(reasonOf(flags([0, 0], [0, 90], [0, 180], [0, 270]))).toBe(
      TERRAIN_PROFILE_REASONS.tooSpread,
    )
    expect(reasonOf(flags([60, 0], [-60, 0], [60, 180], [-60, 180]))).toBe(
      TERRAIN_PROFILE_REASONS.tooSpread,
    )
  })
})
