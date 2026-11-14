import { describe, expect, it } from 'vitest'
import { drapedSegments } from '../../src/features/mars-3d/surfaceView/drapeLine'
import type { Heightfield } from '../../src/features/mars-3d/surfaceView/heightfield'
import { makeFrame, toCoordinate } from '../../src/features/mars-3d/surfaceView/surfacePatch'

// Test fixture only: a flat invented field 1 km across at 100 m.
const field: Heightfield = { heights: new Float32Array(11 * 11).fill(100), size: 11, spacingM: 100 }
const frame = makeFrame({ latitude: 18.44, longitudeEast: 77.45 })
const atM = (x: number, y: number) => toCoordinate(frame, x / 1000, y / 1000)

describe('drapeLine: drapedSegments', () => {
  it('lays the line on the heights, lifted, densified every step', () => {
    const out = drapedSegments([[atM(-200, 0), atM(200, 0)]], frame, field, 50, 0.5)
    // 400 m in 50 m steps: 8 segments, two vertices of three numbers each.
    expect(out.length).toBe(8 * 6)
    for (let i = 1; i < out.length; i += 3) expect(out[i]).toBeCloseTo(100.5, 3)
    expect(out[0]).toBeCloseTo(-200, 0)
    expect(out[out.length - 3]).toBeCloseTo(200, 0)
  })

  it('puts north at −z, as the ground and camera do', () => {
    const out = drapedSegments([[atM(0, 0), atM(0, 100)]], frame, field, 100, 0)
    expect(out[5]).toBeCloseTo(-100, 0)
  })

  it('keeps only the parts over this patch', () => {
    const out = drapedSegments([[atM(0, 0), atM(1000, 0)]], frame, field, 100, 0)
    // The patch reaches 500 m east: five 100 m steps of ten.
    expect(out.length).toBe(5 * 6)
  })
})
