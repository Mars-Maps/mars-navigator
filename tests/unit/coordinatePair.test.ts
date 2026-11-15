import { describe, expect, it } from 'vitest'
import {
  BOTH_NEEDED_ERROR,
  REQUIRED_ERROR,
  X_FORMAT_ERROR,
  X_RANGE_ERROR,
  Y_FORMAT_ERROR,
  Y_RANGE_ERROR,
  axisText,
  checkOnFieldLeave,
  checkPair,
  pairText,
  wholePoint,
} from '../../src/features/mission-ui/coordinatePair'

describe('checkPair: X is longitude °E, Y is latitude', () => {
  it('builds the point from X and Y', () => {
    expect(checkPair('137.4', '-4.6')).toEqual({
      coordinate: { latitude: -4.6, longitudeEast: 137.4 },
      error: null,
      invalidX: false,
      invalidY: false,
    })
  })

  it('accepts the typographic minus and surrounding spaces', () => {
    expect(checkPair(' 137.4 ', '−4.6').coordinate).toEqual({ latitude: -4.6, longitudeEast: 137.4 })
  })

  it('takes both ends of each range: the poles, 0°E and just under 360°E', () => {
    expect(checkPair('0', '90').coordinate).toEqual({ latitude: 90, longitudeEast: 0 })
    expect(checkPair('359.9999', '-90').coordinate).toEqual({ latitude: -90, longitudeEast: 359.9999 })
  })

  it('rejects longitudes outside 0 to under 360 on X only, never wrapping them', () => {
    for (const x of ['360', '-0.1', '-90', '400']) {
      expect(checkPair(x, '10')).toEqual({ coordinate: null, error: X_RANGE_ERROR, invalidX: true, invalidY: false })
    }
  })

  it('rejects latitudes outside −90 to 90 on Y only, never clamping them', () => {
    for (const y of ['90.1', '-91']) {
      expect(checkPair('10', y)).toEqual({ coordinate: null, error: Y_RANGE_ERROR, invalidX: false, invalidY: true })
    }
  })

  it('rejects anything that is not a plain decimal, per field', () => {
    for (const bad of ['abc', '1e3', '137.4°E', '1,5', '1 2']) {
      expect(checkPair(bad, '10')).toMatchObject({ coordinate: null, error: X_FORMAT_ERROR, invalidX: true, invalidY: false })
      expect(checkPair('10', bad)).toMatchObject({ coordinate: null, error: Y_FORMAT_ERROR, invalidX: false, invalidY: true })
    }
  })

  it('names both fields when both are wrong', () => {
    expect(checkPair('400', 'abc')).toEqual({
      coordinate: null,
      error: `${Y_FORMAT_ERROR}. ${X_RANGE_ERROR}`,
      invalidX: true,
      invalidY: true,
    })
  })

  it('asks for the other field when only one is filled', () => {
    expect(checkPair('137.4', '')).toEqual({ coordinate: null, error: BOTH_NEEDED_ERROR, invalidX: false, invalidY: true })
    expect(checkPair('', ' -4.6')).toEqual({ coordinate: null, error: BOTH_NEEDED_ERROR, invalidX: true, invalidY: false })
  })

  it('is empty and quiet when both are blank, unless the point is required', () => {
    expect(checkPair('', '  ')).toEqual({ coordinate: null, error: null, invalidX: false, invalidY: false })
    expect(checkPair('', '', true)).toEqual({ coordinate: null, error: REQUIRED_ERROR, invalidX: true, invalidY: true })
  })
})

describe('checkOnFieldLeave: a field left while focus stays in the row', () => {
  it('flags a complete pair that is out of range, as the commit would', () => {
    // Latitude 95, then Tab onto the button beside the fields.
    expect(checkOnFieldLeave('77.40', '95')).toEqual(checkPair('77.40', '95'))
    expect(checkOnFieldLeave('77.40', '95')?.error).toBe(Y_RANGE_ERROR)
    expect(checkOnFieldLeave('400', '18.47')).toMatchObject({ error: X_RANGE_ERROR, invalidX: true, invalidY: false })
    expect(checkOnFieldLeave('abc', '18.47')?.error).toBe(X_FORMAT_ERROR)
  })

  it('clears a shown error once the pair is valid', () => {
    expect(checkOnFieldLeave('77.40', '18.47')).toEqual({
      coordinate: { latitude: 18.47, longitudeEast: 77.4 },
      error: null,
      invalidX: false,
      invalidY: false,
    })
  })

  it('says nothing while the pair is half filled, even with a bad value in it', () => {
    // Tab from X to an empty Y: the point is still being typed.
    expect(checkOnFieldLeave('400', '')).toBeNull()
    expect(checkOnFieldLeave('', '95')).toBeNull()
    expect(checkOnFieldLeave(' ', '  ')).toBeNull()
  })

  it('leaves a whole point in one field for the commit to fill into both', () => {
    expect(checkOnFieldLeave('-4.6, 137.4', '18')).toBeNull()
    expect(checkOnFieldLeave('77', '4.6°S 137.4°E')).toBeNull()
  })
})

describe('wholePoint: a whole point in one field fills both', () => {
  it('reads "lat, lon", space-separated and the copied form', () => {
    expect(wholePoint('-4.6, 137.4')).toEqual({ latitude: -4.6, longitudeEast: 137.4 })
    expect(wholePoint('-4.6 137.4')).toEqual({ latitude: -4.6, longitudeEast: 137.4 })
    expect(wholePoint('4.6°S 137.4°E')).toEqual({ latitude: -4.6, longitudeEast: 137.4 })
  })

  it('leaves a single number to its own field', () => {
    expect(wholePoint('137.4')).toBeNull()
    expect(wholePoint('')).toBeNull()
  })

  it('does not accept an out-of-range point as whole', () => {
    expect(wholePoint('-4.6, 360')).toBeNull()
  })
})

describe('pairText', () => {
  it('puts longitude in X and latitude in Y, rounded to 4 decimals for editing', () => {
    expect(pairText({ latitude: -4.58712345, longitudeEast: 137.44149999 })).toEqual({ x: '137.4415', y: '-4.5871' })
    expect(pairText(null)).toEqual({ x: '', y: '' })
  })

  it('never prints an exponent or −0', () => {
    expect(axisText(1e-7)).toBe('0')
    expect(axisText(-1e-7)).toBe('0')
  })

  it('round-trips through checkPair', () => {
    const t = pairText({ latitude: -4.6, longitudeEast: 350 })
    expect(checkPair(t.x, t.y).coordinate).toEqual({ latitude: -4.6, longitudeEast: 350 })
  })
})
