import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  clampPolar,
  easeStep,
  isPinch,
  rotateSpeedForAltitude,
  towardCursorFraction,
  wheelZoomFactor,
  zoomAltitude,
} from '../../src/features/mars-3d/cameraMath'

const R = 3.3895
const LIMITS = { min: 0.2, max: 25 }

describe('cameraMath: zoom', () => {
  it('zooms in for wheel away from the user and out for towards', () => {
    expect(wheelZoomFactor(-100)).toBeLessThan(1)
    expect(wheelZoomFactor(100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it('keeps the mouse-wheel rate unchanged', () => {
    expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(0.15), 12)
    expect(wheelZoomFactor(100, false)).toBe(wheelZoomFactor(100))
  })

  it('zooms a full pinch about as far as a few wheel notches', () => {
    expect(wheelZoomFactor(-4, true)).toBeCloseTo(Math.exp(-0.04), 12)
    // A full pinch: ~30 events of 4 px. A wheel notch: 100 px.
    let pinch = 1
    for (let i = 0; i < 30; i++) pinch *= wheelZoomFactor(-4, true)
    const notch = wheelZoomFactor(-100)
    const notches = Math.log(pinch) / Math.log(notch)
    expect(notches).toBeGreaterThan(3)
    expect(notches).toBeLessThan(10)
    expect(wheelZoomFactor(4, true) * wheelZoomFactor(-4, true)).toBeCloseTo(1, 12)
  })

  it('reads only small ctrlKey pixel deltas as a pinch', () => {
    expect(isPinch(true, 0, 3)).toBe(true)
    expect(isPinch(true, 0, -4.5)).toBe(true)
    // Ctrl held over a real mouse wheel: whole notches or lines keep the wheel rate.
    expect(isPinch(true, 0, 100)).toBe(false)
    expect(isPinch(true, 0, -120)).toBe(false)
    expect(isPinch(true, 1, 3)).toBe(false)
    expect(isPinch(false, 0, 3)).toBe(false)
  })

  it('makes opposite wheel notches cancel exactly', () => {
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 12)
  })

  it('holds the altitude inside the limits', () => {
    expect(zoomAltitude(1, 0.01, LIMITS)).toBe(LIMITS.min)
    expect(zoomAltitude(10, 100, LIMITS)).toBe(LIMITS.max)
    expect(zoomAltitude(4, 0.5, LIMITS)).toBe(2)
  })
})

describe('cameraMath: zoom towards the cursor', () => {
  it('swings halfway when the altitude halves', () => {
    expect(towardCursorFraction(4, 2)).toBeCloseTo(0.5, 12)
  })

  it('does not swing when zooming out or standing still', () => {
    expect(towardCursorFraction(2, 4)).toBe(0)
    expect(towardCursorFraction(3, 3)).toBe(0)
  })

  it('does not swing at the altitude floor, where the zoom was clamped to nothing', () => {
    const at = zoomAltitude(LIMITS.min, 0.5, LIMITS)
    expect(towardCursorFraction(LIMITS.min, at)).toBe(0)
  })
})

describe('cameraMath: drag speed and easing', () => {
  it('slows dragging close to the surface and caps it far out', () => {
    expect(rotateSpeedForAltitude(0.2, R)).toBeLessThan(rotateSpeedForAltitude(5, R))
    expect(rotateSpeedForAltitude(100, R)).toBe(1)
    expect(rotateSpeedForAltitude(0, R)).toBe(0.002)
  })

  it('eases the same total amount at any frame rate', () => {
    const remainingAfter = (frames: number, dt: number) => {
      let remaining = 1
      for (let i = 0; i < frames; i++) remaining *= 1 - easeStep(dt, 8)
      return remaining
    }
    expect(remainingAfter(60, 1 / 60)).toBeCloseTo(remainingAfter(30, 1 / 30), 12)
  })
})

describe('cameraMath: clampPolar', () => {
  const margin = 0.01

  it('leaves directions away from the poles untouched', () => {
    const d = new Vector3(1, 0.5, 0).normalize()
    const before = d.clone()
    expect(clampPolar(d, margin).equals(before)).toBe(true)
  })

  it('pulls a direction at the pole back to the margin, still unit length', () => {
    const d = clampPolar(new Vector3(0, 1, 0), margin)
    expect(d.y).toBeCloseTo(Math.cos(margin), 12)
    expect(d.length()).toBeCloseTo(1, 12)
  })

  it('keeps the azimuth of a near-pole direction', () => {
    const d = clampPolar(new Vector3(0, -1, 1e-6).normalize(), margin)
    expect(d.y).toBeCloseTo(-Math.cos(margin), 12)
    expect(d.x).toBeCloseTo(0, 12)
    expect(d.z).toBeGreaterThan(0)
  })
})
