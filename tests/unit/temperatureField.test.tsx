import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  derived,
  isAvailable,
  localTrueSolarTimeHours,
  marsSolarTime,
  official,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MarsSolarTime,
  type MeasuredGroundTemperature,
  type TemperatureEstimate,
  type TemperatureModel,
} from '../../src/domain'
import { PointMenuView } from '../../src/features/mission-ui/PointMenu'
import { TemperatureField } from '../../src/features/mission-ui/temperature/TemperatureField'
import {
  NO_TEMPERATURE_REASON,
  formatCelsius,
  formatEstimate,
  readTemperature,
  seasonAt,
  type TemperatureInputs,
} from '../../src/features/mission-ui/temperature/temperatureMath'

// Test fixtures only — an invented model and invented measurements, never run in the app.
const POINT: MarsCoordinate = { latitude: 10, longitudeEast: 20 }
const SOUTH: MarsCoordinate = { latitude: -30, longitudeEast: 20 }
const POLE: MarsCoordinate = { latitude: 88, longitudeEast: 20 }
// 2026-10-28 20:00 UTC, and six hours later.
const UTC_A = Date.UTC(2026, 9, 28, 20, 0, 0)
const UTC_B = UTC_A + 6 * 3_600_000

/** Warmer later in the local day, so a time change shows in the value; UNAVAILABLE near the poles. */
const fixtureModel: TemperatureModel = (point, solar) =>
  Math.abs(point.latitude) > 87
    ? unavailable('fixture-outside-band')
    : derived<TemperatureEstimate>(
        { temperatureK: 180 + 4 * localTrueSolarTimeHours(solar, point.longitudeEast), errorK: 8 },
        'fixture-model',
      )

const fixtureMeasured: Classified<MeasuredGroundTemperature> = official(
  {
    site: 'fixture-site',
    instrument: 'fixture-instrument',
    sol: 7,
    dateUtc: '2026-01-02',
    solarLongitudeDeg: null,
    minK: official(190, 'fixture-source'),
    maxK: unavailable('fixture-no-value'),
    caveat: 'fixture-caveat',
  },
  'fixture-record-source',
)

const inputs = (utcMs: number, over: Partial<TemperatureInputs> = {}): TemperatureInputs => ({
  solar: marsSolarTime(utcMs),
  model: fixtureModel,
  measured: null,
  ...over,
})

const solarAt = (utcMs: number): MarsSolarTime => {
  const s = marsSolarTime(utcMs)
  if (!isAvailable(s)) throw new Error('fixture instant')
  return s.value
}

describe('readTemperature', () => {
  it('stays UNAVAILABLE with the old reason when no model is handed in', () => {
    for (const r of [readTemperature(POINT, null), readTemperature(POINT, inputs(UTC_A, { model: null }))]) {
      expect(r.estimate).toEqual(unavailable(NO_TEMPERATURE_REASON))
      expect(r.conditions).toBeNull()
    }
  })

  it('keeps a measurement even without a model', () => {
    const r = readTemperature(POINT, inputs(UTC_A, { model: null, measured: () => fixtureMeasured }))
    expect(r.measured).toBe(fixtureMeasured)
    expect(isAvailable(r.estimate)).toBe(false)
  })

  it('runs the model for the mission time, and says what local time and season it is for', () => {
    const model = vi.fn(fixtureModel)
    const r = readTemperature(POINT, inputs(UTC_A, { model }))
    expect(model).toHaveBeenCalledWith(POINT, solarAt(UTC_A))
    expect(r.estimate.classification).toBe('DERIVED')
    expect(r.conditions?.localSolarHours).toBeCloseTo(localTrueSolarTimeHours(solarAt(UTC_A), POINT.longitudeEast), 9)
    expect(r.conditions?.solarLongitudeDeg).toBe(solarAt(UTC_A).solarLongitudeDeg)
    expect(r.conditions?.method).toMatch(/Mars24/)
  })

  it('changes when the mission time changes', () => {
    const a = readTemperature(POINT, inputs(UTC_A)).estimate
    const b = readTemperature(POINT, inputs(UTC_B)).estimate
    expect(isAvailable(a) && isAvailable(b)).toBe(true)
    if (isAvailable(a) && isAvailable(b)) expect(a.value.temperatureK).not.toBeCloseTo(b.value.temperatureK, 3)
  })

  it("passes the model's own UNAVAILABLE reason through, with no conditions", () => {
    const r = readTemperature(POLE, inputs(UTC_A))
    expect(r.estimate).toEqual(unavailable('fixture-outside-band'))
    expect(r.conditions).toBeNull()
  })

  it('is UNAVAILABLE when the mission time is not a valid instant', () => {
    const r = readTemperature(POINT, inputs(Number.NaN))
    expect(isAvailable(r.estimate)).toBe(false)
    if (!isAvailable(r.estimate)) expect(r.estimate.reason).toMatch(/not a valid instant/)
  })

  it('never passes a non-finite model value on as a number', () => {
    for (const bad of [{ temperatureK: Number.NaN, errorK: 8 }, { temperatureK: 250, errorK: Number.POSITIVE_INFINITY }]) {
      const r = readTemperature(POINT, inputs(UTC_A, { model: () => derived(bad, 'fixture-model') }))
      expect(isAvailable(r.estimate)).toBe(false)
    }
  })
})

describe('temperature wording', () => {
  it('writes Celsius with a true minus sign, and no sign on a rounded zero', () => {
    expect(formatCelsius(250)).toBe('−23 °C')
    expect(formatCelsius(293.15)).toBe('20 °C')
    expect(formatCelsius(272.9)).toBe('0 °C')
  })

  it('writes the estimate with its error, one decimal only when the error is below 1 K', () => {
    expect(formatEstimate({ temperatureK: 250, errorK: 8 })).toBe('−23 °C ± 8 °C')
    expect(formatEstimate({ temperatureK: 250, errorK: 0.5 })).toBe('−23.1 °C ± 0.5 °C')
  })

  it('rounds the error up, so it is never shown smaller than it is', () => {
    expect(formatEstimate({ temperatureK: 250, errorK: 7.4 })).toBe('−23 °C ± 8 °C')
    expect(formatEstimate({ temperatureK: 250, errorK: 0.31 })).toBe('−23.1 °C ± 0.4 °C')
    expect(formatEstimate({ temperatureK: 250, errorK: 0.3 })).toBe('−23.1 °C ± 0.3 °C')
  })

  it("names the season of the point's own hemisphere", () => {
    expect(seasonAt(0, 18)).toBe('northern spring')
    expect(seasonAt(125, 18)).toBe('northern summer')
    expect(seasonAt(125, -5)).toBe('southern winter')
    expect(seasonAt(359.9, 0)).toBe('northern winter')
    expect(seasonAt(360, 0)).toBe('northern spring')
    expect(seasonAt(-90, -10)).toBe('southern summer')
  })
})

describe('TemperatureField', () => {
  const render = (point: MarsCoordinate, i: TemperatureInputs | null) =>
    renderToStaticMarkup(<TemperatureField reading={readTemperature(point, i)} />)

  it('shows the estimate with its error, marked DERIVED with the method, and the time it is for', () => {
    const html = render(POINT, inputs(UTC_A))
    expect(html).toContain('>Model estimate<')
    expect(html).toMatch(/−?\d+ °C ± 8 °C/)
    expect(html).toContain('DERIVED')
    expect(html).toContain('fixture-model')
    expect(html).toMatch(/>at \d\d:\d\d local solar time</)
    // The season the estimate is for is in the mark beside the time.
    expect(html).toMatch(/Ls \d+\.\d° \(northern (spring|summer|autumn|winter)\)\. /)
    expect(html).toContain('>No measurement here<')
    expect(html).toContain('Measured values exist only at Jezero and Gale')
  })

  it('puts a mark on every number it shows', () => {
    const html = render(POINT, inputs(UTC_A, { measured: () => fixtureMeasured }))
    const values = html.match(/<span class="tabular-nums text-ink">[^<]*<\/span>/g) ?? []
    const marked = html.match(/<span class="tabular-nums text-ink">[^<]*<\/span><span tabindex="0" class="[^"]*cursor-help/g) ?? []
    expect(values.length).toBeGreaterThan(0)
    expect(marked).toHaveLength(values.length)
    // The time line carries its own Mars24 mark.
    expect(html).toMatch(/local solar time.*?<span tabindex="0"[^>]*>.*?DERIVED.*?Mars24/)
  })

  it('shows the measurement first, OFFICIAL, and a missing value as UNAVAILABLE, never 0', () => {
    const html = render(POINT, inputs(UTC_A, { measured: () => fixtureMeasured }))
    expect(html.indexOf('Latest record from fixture-site, fixture-instrument')).toBeLessThan(html.indexOf('Model estimate'))
    // The record's source and caveat are in the heading's mark.
    expect(html).toContain('fixture-record-source. fixture-caveat')
    expect(html).toContain('sol 7, 2026-01-02')
    expect(html).toContain('−83 °C')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('fixture-no-value')
    expect(html).not.toContain('Measured values exist only at Jezero and Gale')
  })

  it('at a site with no usable record, says why above the estimate, never a number', () => {
    const html = render(POINT, inputs(UTC_A, { measured: () => unavailable('fixture-feed-loading') }))
    expect(html.indexOf('>Measured<')).toBeLessThan(html.indexOf('Model estimate'))
    expect(html).toContain('fixture-feed-loading')
    expect(html).not.toContain('Measured values exist only at Jezero and Gale')
  })

  it("shows UNAVAILABLE with the model's reason, and no time or number", () => {
    const html = render(POLE, inputs(UTC_A))
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain('fixture-outside-band')
    expect(html).not.toContain('°C')
    expect(html).not.toContain('local solar time')
  })

  it('names the southern season at a southern point', () => {
    expect(render(SOUTH, inputs(UTC_A))).toMatch(/\(southern (spring|summer|autumn|winter)\)/)
  })
})

describe('PointMenuView with a temperature model', () => {
  const html = (utcMs: number) =>
    renderToStaticMarkup(<PointMenuView point={POINT} departure={null} temperature={inputs(utcMs)} />)

  it('shows the estimate in the Temperature row, in the list and in the pager', () => {
    const page = html(UTC_A)
    expect(page.match(/>Model estimate</g)).toHaveLength(2)
  })

  it('shows a different estimate for a different mission time', () => {
    const estimate = (page: string) => page.match(/−?\d+ °C ± 8 °C/)?.[0]
    expect(estimate(html(UTC_A))).toBeDefined()
    expect(estimate(html(UTC_A))).not.toBe(estimate(html(UTC_B)))
  })
})
