import { describe, expect, it } from 'vitest'
import { hexToRgb, paintRamp, parseRamp, rampColor, rampCss, type RampStop } from '../../src/lib/colorRamp'

// Test fixture only: an invented three-stop ramp.
const STOPS: RampStop[] = [
  { value: 0, color: '#000000' },
  { value: 10, color: '#ff0000' },
  { value: 30, color: '#ffffff' },
]

describe('colour ramp', () => {
  it('parses #rrggbb and rejects anything else', () => {
    expect(hexToRgb('#1c5cab')).toEqual([0x1c, 0x5c, 0xab])
    expect(() => hexToRgb('red')).toThrow(/#rrggbb/)
    expect(() => hexToRgb('#fff')).toThrow()
  })

  it('needs rising stops', () => {
    expect(() => parseRamp([])).toThrow()
    expect(() => parseRamp([STOPS[1], STOPS[0]])).toThrow(/rise/)
  })

  it('interpolates between stops and clamps beyond the ends', () => {
    const ramp = parseRamp(STOPS)
    expect(rampColor(ramp, 5)).toEqual([127.5, 0, 0])
    expect(rampColor(ramp, 20)).toEqual([255, 127.5, 127.5])
    expect(rampColor(ramp, -100)).toEqual([0, 0, 0])
    expect(rampColor(ramp, 1e9)).toEqual([255, 255, 255])
    expect(rampColor(ramp, 10)).toEqual([255, 0, 0])
  })

  it('paints a value per pixel, opaque, and leaves a gap or a non-finite value transparent', () => {
    const px = paintRamp([5, Number.NaN, 30, Number.POSITIVE_INFINITY], STOPS)
    expect(Array.from(px)).toEqual([128, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0])
  })

  it('writes a CSS gradient with each stop at its place', () => {
    expect(rampCss(STOPS)).toBe('linear-gradient(to right, #000000 0.0%, #ff0000 33.3%, #ffffff 100.0%)')
  })
})
