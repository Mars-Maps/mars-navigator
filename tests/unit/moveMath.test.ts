import { describe, expect, it } from 'vitest'
import {
  clampAltitude,
  clampEye,
  EYE_HEIGHT_M,
  MAX_EYE_HEIGHT_M,
  MAX_FLY_ABOVE_M,
  MAX_SPEED_M_S,
  MIN_CLEARANCE_M,
  moveStep,
  scaledAbove,
  speedFor,
  type Move,
  type MoveKeys,
} from '../../src/features/mars-3d/surfaceView/moveMath'

const keys = (on: Partial<MoveKeys> = {}): MoveKeys => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  run: false,
  ...on,
})
const out = (): Move => ({ dx: 0, dy: 0, dz: 0 })
const close = (m: Move, dx: number, dy: number, dz: number) => {
  expect(m.dx).toBeCloseTo(dx, 6)
  expect(m.dy).toBeCloseTo(dy, 6)
  expect(m.dz).toBeCloseTo(dz, 6)
}

describe('speedFor', () => {
  it('walks at 40 m/s near the ground, faster the higher, five times with Shift, capped', () => {
    expect(speedFor(1.7, false)).toBe(40)
    expect(speedFor(100, false)).toBe(150)
    expect(speedFor(100, true)).toBe(750)
    expect(speedFor(3000, true)).toBe(MAX_SPEED_M_S)
  })
})

describe('moveStep walking', () => {
  it('moves level along the yaw, never changing height', () => {
    close(moveStep('walk', keys({ forward: true }), 0, 0.5, 10, 1, out()), 0, 10, 0)
    close(moveStep('walk', keys({ forward: true }), Math.PI / 2, -0.5, 10, 1, out()), 10, 0, 0)
    close(moveStep('walk', keys({ back: true }), 0, 0, 10, 1, out()), 0, -10, 0)
    close(moveStep('walk', keys({ right: true }), 0, 0, 10, 1, out()), 10, 0, 0)
  })

  it('ignores the fly keys and goes no faster on a diagonal', () => {
    close(moveStep('walk', keys({ up: true }), 0, 0, 10, 1, out()), 0, 0, 0)
    const d = moveStep('walk', keys({ forward: true, right: true }), 0, 0, 10, 1, out())
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(10)
  })

  it('scales with the frame time and stays put with no key', () => {
    close(moveStep('walk', keys({ forward: true }), 0, 0, 10, 0.1, out()), 0, 1, 0)
    close(moveStep('walk', keys(), 0, 0, 10, 1, out()), 0, 0, 0)
  })
})

describe('moveStep flying', () => {
  it('flies where the camera looks, pitch included', () => {
    close(moveStep('fly', keys({ forward: true }), 0, 0, 10, 1, out()), 0, 10, 0)
    const up = moveStep('fly', keys({ forward: true }), 0, Math.PI / 4, 10, 1, out())
    close(up, 0, 10 * Math.SQRT1_2, 10 * Math.SQRT1_2)
    const down = moveStep('fly', keys({ back: true }), 0, Math.PI / 4, 10, 1, out())
    close(down, 0, -10 * Math.SQRT1_2, -10 * Math.SQRT1_2)
  })

  it('strafes level whatever the pitch, and climbs or descends straight with Space and C', () => {
    close(moveStep('fly', keys({ right: true }), 0, 1, 10, 1, out()), 10, 0, 0)
    close(moveStep('fly', keys({ up: true }), 0.3, -1, 10, 1, out()), 0, 0, 10)
    close(moveStep('fly', keys({ down: true }), 0.3, 1, 10, 1, out()), 0, 0, -10)
    close(moveStep('fly', keys({ up: true, down: true }), 0, 0, 10, 1, out()), 0, 0, 0)
  })

  it('is no faster on a combined input', () => {
    const d = moveStep('fly', keys({ forward: true, right: true, up: true }), 0.7, 0.4, 10, 1, out())
    expect(Math.hypot(d.dx, d.dy, d.dz)).toBeCloseTo(10)
  })
})

describe('clamps', () => {
  it('keeps a flight between the clearance floor and the ceiling over the ground', () => {
    expect(clampAltitude(-2500, -2000)).toBe(-2000 + MIN_CLEARANCE_M)
    expect(clampAltitude(-1900, -2000)).toBe(-1900)
    expect(clampAltitude(50_000, -2000)).toBe(-2000 + MAX_FLY_ABOVE_M)
  })

  it('keeps a walking eye within its limits', () => {
    expect(clampEye(0)).toBe(EYE_HEIGHT_M)
    expect(clampEye(12)).toBe(12)
    expect(clampEye(1e6)).toBe(MAX_EYE_HEIGHT_M)
  })

  it('applies the wheel on a log scale', () => {
    expect(scaledAbove(100, 0)).toBe(100)
    expect(scaledAbove(100, Math.LN2)).toBeCloseTo(200)
    expect(scaledAbove(100, -Math.LN2)).toBeCloseTo(50)
  })
})
