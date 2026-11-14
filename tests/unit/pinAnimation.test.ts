import { describe, expect, it } from 'vitest'
import { PIN_ANIMATION_S, pinPose, type PinPose } from '../../src/features/mars-3d/pinAnimation'

const pose = (age: number): PinPose => pinPose(age, { scale: NaN, angle: NaN })

describe('pinAnimation: pinPose', () => {
  it('starts from nothing, upright', () => {
    expect(pose(0).scale).toBeCloseTo(0, 10)
    expect(pose(0).angle).toBeCloseTo(0, 10)
  })

  it('overshoots full size a little, then reaches it', () => {
    let peak = 0
    for (let t = 0; t < PIN_ANIMATION_S; t += 0.005) peak = Math.max(peak, pose(t).scale)
    expect(peak).toBeGreaterThan(1.05)
    expect(peak).toBeLessThan(1.2)
    expect(pose(0.35).scale).toBeCloseTo(1, 10)
  })

  it('wobbles both ways, and the swing dies down', () => {
    const angles = []
    for (let t = 0; t < PIN_ANIMATION_S; t += 0.005) angles.push(pose(t).angle)
    expect(Math.max(...angles)).toBeGreaterThan(0.05)
    expect(Math.min(...angles)).toBeLessThan(-0.05)
    expect(Math.abs(pose(0.8).angle)).toBeLessThan(0.01)
  })

  it('is at rest after the animation, and for nonsense ages', () => {
    for (const age of [PIN_ANIMATION_S, 5, Infinity, -1, NaN]) {
      expect(pose(age)).toEqual({ scale: 1, angle: 0 })
    }
  })

  it('writes into the object it is given', () => {
    const out = { scale: 0, angle: 0 }
    expect(pinPose(0.1, out)).toBe(out)
  })
})
