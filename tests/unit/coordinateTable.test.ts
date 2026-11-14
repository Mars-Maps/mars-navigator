import { describe, expect, it } from 'vitest'
import { parseMarsCoordinate } from '../../src/domain'
import { TABLE_DECIMALS, coordinateRows } from '../../src/features/mission-ui/coordinateTable'

const rows = (latitude: number, longitudeEast: number) => coordinateRows({ latitude, longitudeEast })

describe('coordinateRows', () => {
  it('shows three decimals with hemisphere letters', () => {
    expect(TABLE_DECIMALS).toBe(3)
    expect(rows(-4.58712, 137.44149)).toEqual({
      latitude: '4.587°S',
      longitudeEast: '137.441°E',
      longitudeSigned: '137.441°E',
      copyable: '4.587°S 137.441°E',
    })
  })

  it('gives east of 180 as west in ±180, and keeps 0–360 as it is', () => {
    const r = rows(10, 350)
    expect(r.longitudeEast).toBe('350.000°E')
    expect(r.longitudeSigned).toBe('10.000°W')
    expect(rows(0, 180.0006).longitudeSigned).toBe('179.999°W')
  })

  it('keeps 180 itself east, the boundary of ±180', () => {
    expect(rows(0, 180).longitudeSigned).toBe('180.000°E')
    expect(rows(0, 180.0004).longitudeSigned).toBe('180.000°E')
  })

  it('wraps a longitude that rounds to 360 to 0.000°E in every row, never 360', () => {
    const r = rows(1, 359.9996)
    expect(r.longitudeEast).toBe('0.000°E')
    expect(r.longitudeSigned).toBe('0.000°E')
    expect(r.copyable).toBe('1.000°N 0.000°E')
    expect(JSON.stringify(r)).not.toContain('360')
  })

  it('keeps a longitude just under the wrap at 359.999°E, 0.001°W', () => {
    const r = rows(0, 359.9994)
    expect(r.longitudeEast).toBe('359.999°E')
    expect(r.longitudeSigned).toBe('0.001°W')
  })

  it('shows 0°E as 0.000°E in both conventions', () => {
    expect(rows(0, 0)).toMatchObject({ longitudeEast: '0.000°E', longitudeSigned: '0.000°E' })
  })

  it('never prints −0.000 for a latitude that rounds to zero', () => {
    expect(rows(-0.0004, 10).latitude).toBe('0.000°N')
    expect(rows(0.0004, 10).latitude).toBe('0.000°N')
  })

  it('handles the poles', () => {
    expect(rows(90, 0).latitude).toBe('90.000°N')
    expect(rows(-90, 0).latitude).toBe('90.000°S')
  })

  it('rows always agree with the copyable form', () => {
    for (const [lat, lon] of [[-4.58712, 137.44149], [12.3456, 359.9996], [-89.9999, 0.0004]]) {
      const r = rows(lat, lon)
      expect(r.copyable).toBe(`${r.latitude} ${r.longitudeEast}`)
    }
  })

  it('copies a form the search bar parses back to the rounded point', () => {
    const parsed = parseMarsCoordinate(rows(-4.58712, 350.44149).copyable)
    expect(parsed).toEqual({ ok: true, coordinate: { latitude: -4.587, longitudeEast: 350.441 } })
  })
})
