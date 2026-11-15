import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  GALE_RAD_REFERENCE,
  HASSLER_2014_CITATION,
  HASSLER_2014_DOI,
} from '../../src/data/radiation/galeRadReference'
import { JEZERO } from '../../src/data/sites/sites'
import { formatMeasuredValue, isAvailable, type MarsCoordinate } from '../../src/domain'
import { PointMenuView } from '../../src/features/mission-ui/PointMenu'
import { describePoint } from '../../src/features/mission-ui/pointFields'
import { methodologyText, shownMarkup, visibleText } from './methodology.helpers'

const GALE: MarsCoordinate = { latitude: -4.59, longitudeEast: 137.44 }

describe('Gale radiation reference', () => {
  it('carries the paper’s three figures with their stated uncertainties, OFFICIAL and cited', () => {
    const r = GALE_RAD_REFERENCE
    for (const m of [r.doseEquivalent, r.absorbedDose, r.qualityFactor]) {
      expect(m.classification).toBe('OFFICIAL')
      if (m.classification === 'OFFICIAL') {
        expect(m.source).toContain(HASSLER_2014_CITATION)
        expect(m.source).toMatch(/— ".+"$/)
        expect(m.value.uncertainty).toBeGreaterThan(0)
      }
    }
    expect(isAvailable(r.doseEquivalent) && r.doseEquivalent.value).toEqual({
      value: 0.64,
      uncertainty: 0.12,
      unit: 'mSv/day',
    })
    expect(isAvailable(r.absorbedDose) && r.absorbedDose.value).toEqual({
      value: 0.21,
      uncertainty: 0.04,
      unit: 'mGy/day',
    })
    expect(isAvailable(r.qualityFactor) && r.qualityFactor.value).toEqual({ value: 3.05, uncertainty: 0.3, unit: '' })
    expect(HASSLER_2014_DOI).toBe('https://doi.org/10.1126/science.1244797')
    expect(HASSLER_2014_CITATION).toMatch(/Hassler.*2014.*Science.*343.*1244797/)
    expect(HASSLER_2014_CITATION).toMatch(/checked 2026-10-28/)
  })

  it('names the site, instrument, elevation, period and solar conditions', () => {
    const r = GALE_RAD_REFERENCE
    expect(r.site).toBe('Gale crater')
    expect(r.instrument).toBe('Curiosity RAD')
    expect(r.elevationKm).toBe(-4.4)
    expect(r.period).toMatch(/2012.*2013/)
    expect(r.conditions).toMatch(/solar cycle 24/)
  })

  it('formats value and uncertainty to the same decimals, as the paper printed them', () => {
    expect(formatMeasuredValue({ value: 0.64, uncertainty: 0.12, unit: 'mSv/day' }, 2)).toBe('0.64 ± 0.12 mSv/day')
    expect(formatMeasuredValue({ value: 0.21, uncertainty: 0.04, unit: 'mGy/day' }, 3)).toBe('0.210 ± 0.040 mGy/day')
    expect(formatMeasuredValue({ value: 3.05, uncertainty: 0.3, unit: '' }, 2)).toBe('3.05 ± 0.30')
  })

  it('never gives a number for radiation at Jezero, at Gale itself, or anywhere else', () => {
    for (const point of [JEZERO.centre, GALE, { latitude: 0, longitudeEast: 0 }]) {
      const radiation = describePoint(point, null).radiation.dose
      expect(radiation.classification).toBe('UNAVAILABLE')
      if (radiation.classification === 'UNAVAILABLE') {
        expect(radiation.reason).toMatch(/no dosimeter/)
        expect(radiation.reason).toMatch(/not scaled/)
      }
    }
  })
})

describe('PointMenuView radiation reference', () => {
  // With a departure set, the five UNAVAILABLE values are elevation,
  // temperature, the radiation dose and atmosphere overhead, and the
  // geologic unit, as in pointFields.test.
  const render = (reference = GALE_RAD_REFERENCE) =>
    renderToStaticMarkup(<PointMenuView point={JEZERO.centre} departure={GALE} radiationReference={reference} />)

  it('gives the value, its uncertainty, place, dates, conditions and citation in the field’s methodology, not in the menu', () => {
    const html = render()
    expect(html).toContain('0.64 ± 0.12 mSv/day')
    expect(html).toContain('(0.210 ± 0.040 mGy/day)')
    expect(html).toContain('Measured at Gale crater (Curiosity RAD, −4.4 km, 7 Aug 2012 – 1 Jun 2013, about 300 sols, near the maximum of solar cycle 24)')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('10.1126/science.1244797')
    // The point's own radiation field is still unavailable, in the list and in the pager.
    const [list, pager] = html.split('role="group"')
    expect(list.match(/data-radiation-reference/g)).toHaveLength(1)
    expect(pager.match(/data-radiation-reference/g)).toHaveLength(1)
    // Six: elevation, slope, temperature, the dose, the atmosphere overhead, the unit.
    expect(shownMarkup(list).match(/UNAVAILABLE/g)).toHaveLength(6)
    expect(html).toMatch(/not scaled to this point/i)
    // One click away: nothing of the measurement takes room in the menu itself.
    expect(shownMarkup(html)).not.toContain('data-radiation-reference')
    expect(visibleText(html)).not.toMatch(/mSv|mGy|Measured at Gale/)
    expect(methodologyText(html)).toContain('0.64 ± 0.12 mSv/day')
  })

  it('shows no reference, and no number with a radiation unit, when none is passed', () => {
    const html = renderToStaticMarkup(<PointMenuView point={JEZERO.centre} departure={null} />)
    expect(html).not.toContain('data-radiation-reference')
    expect(html).not.toMatch(/mSv|mGy/)
  })
})
