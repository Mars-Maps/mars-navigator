import { describe, expect, it } from 'vitest'
import {
  formatMarsCoordinate,
  isValidCoordinate,
  parseMarsCoordinate,
  validateCoordinate,
} from '../../src/domain'

const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })

describe('formatMarsCoordinate', () => {
  it.each([
    [at(0, 0), '0.0°N 0.0°E'],
    [at(-12.3, 243.6), '12.3°S 243.6°E'],
    [at(4.5, 137.4), '4.5°N 137.4°E'],
    [at(0, 359.94), '0.0°N 359.9°E'],
  ])('%o → %s', (c, expected) => {
    expect(formatMarsCoordinate(c)).toBe(expected)
  })

  it('wraps at the 0/360 seam after rounding, never printing 360.0°E', () => {
    expect(formatMarsCoordinate(at(0, 359.96))).toBe('0.0°N 0.0°E')
  })

  it('prints a latitude that rounds to zero as N, never −0.0 or 0.0°S', () => {
    expect(formatMarsCoordinate(at(-0.04, 10))).toBe('0.0°N 10.0°E')
  })

  it('formats both poles', () => {
    expect(formatMarsCoordinate(at(90, 0))).toBe('90.0°N 0.0°E')
    expect(formatMarsCoordinate(at(-90, 180))).toBe('90.0°S 180.0°E')
  })

  it('honours decimals', () => {
    expect(formatMarsCoordinate(at(12.3456, 243.6), 2)).toBe('12.35°N 243.60°E')
  })
})

describe('parseMarsCoordinate', () => {
  it.each([
    ['12.3°S 243.6°E', at(-12.3, 243.6)],
    ['12.3 ° n , 243.6 ° e', at(12.3, 243.6)],
    ['-4.6, 137.4', at(-4.6, 137.4)],
    ['−4.6 137.4', at(-4.6, 137.4)],
    ['  0, 0  ', at(0, 0)],
    ['90, 0', at(90, 0)],
    ['-90, 359.9', at(-90, 359.9)],
  ])('accepts %s', (text, expected) => {
    expect(parseMarsCoordinate(text)).toEqual({ ok: true, coordinate: expected })
  })

  it.each([
    ['90.01, 0', 'latitude-range'],
    ['-90.01, 0', 'latitude-range'],
    ['91°N 0°E', 'latitude-range'],
    ['0, 360', 'longitude-range'],
    ['0, -0.1', 'longitude-range'],
    // ±180 is a dataset convention, converted by its adapter — not typed here.
    ['0, -137.4', 'longitude-range'],
    ['', 'format'],
    ['abc', 'format'],
    ['1e2, 3', 'format'],
    ['1, 2, 3', 'format'],
    ['12.3°W 10°E', 'format'],
  ])('rejects %s as %s', (text, reason) => {
    expect(parseMarsCoordinate(text)).toEqual({ ok: false, reason })
  })

  it('round-trips everything formatMarsCoordinate writes, seam and poles included', () => {
    for (const c of [at(0, 0), at(-12.3, 243.6), at(90, 0), at(-90, 180), at(0, 359.9)]) {
      expect(parseMarsCoordinate(formatMarsCoordinate(c))).toEqual({ ok: true, coordinate: c })
    }
  })
})

describe('validateCoordinate', () => {
  it.each([at(90, 0), at(-90, 0), at(0, 0), at(0, 359.999)])('accepts %o', (c) => {
    expect(validateCoordinate(c)).toEqual({ ok: true })
    expect(isValidCoordinate(c)).toBe(true)
  })

  it.each([
    [at(90.0001, 0), 'latitude-range'],
    [at(-90.0001, 0), 'latitude-range'],
    // 360 is 0 and must be wrapped by the adapter before it gets here.
    [at(0, 360), 'longitude-range'],
    [at(0, -0.0001), 'longitude-range'],
    [at(Number.NaN, 0), 'format'],
    [at(0, Number.POSITIVE_INFINITY), 'format'],
  ])('rejects %o as %s', (c, reason) => {
    expect(validateCoordinate(c)).toEqual({ ok: false, reason })
    expect(isValidCoordinate(c)).toBe(false)
  })
})
