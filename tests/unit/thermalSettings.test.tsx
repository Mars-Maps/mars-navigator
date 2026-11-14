import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  derived,
  isAvailable,
  marsSolarTime,
  unavailable,
  type Classified,
} from '../../src/domain'
import { NO_SEASONAL_MAP_REASON, ThermalSettingsView } from '../../src/features/mission-ui/ThermalSettings'
import type { ThermalVariant } from '../../src/state'
import { thermalLocalTime } from '../../src/features/mission-ui/thermalLocalTime'

// GISS Mars24 worked example: LTST at 0° is 23.6484 h (as in mars24.test.ts).
const GISS_EXAMPLE_UTC = Date.UTC(2000, 0, 6, 0, 0, 0)

describe('thermalLocalTime', () => {
  it('is DERIVED local true solar time at the view centre, with the Mars24 method', () => {
    const t = thermalLocalTime(marsSolarTime(GISS_EXAMPLE_UTC), {
      latitude: 10,
      longitudeEast: 0,
    })
    if (!isAvailable(t)) throw new Error('expected a value')
    expect(t.classification).toBe('DERIVED')
    expect(t.value).toBeCloseTo(23.6484, 4)
    if (t.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(t.method).toContain('Mars24')
    expect(t.method).toContain('10.0°N')
  })

  it('is local noon under the sun', () => {
    const solar = marsSolarTime(Date.UTC(2026, 9, 28, 12))
    if (!isAvailable(solar)) throw new Error('expected a value')
    const t = thermalLocalTime(solar, solar.value.subsolarPoint)
    if (!isAvailable(t)) throw new Error('expected a value')
    expect(t.value).toBeCloseTo(12, 6)
  })

  it('is UNAVAILABLE before the camera settles, at a pole, or without a valid time', () => {
    const solar = marsSolarTime(GISS_EXAMPLE_UTC)
    expect(thermalLocalTime(solar, null).classification).toBe('UNAVAILABLE')
    expect(
      thermalLocalTime(solar, { latitude: 89.8, longitudeEast: 30 }).classification,
    ).toBe('UNAVAILABLE')
    expect(
      thermalLocalTime(marsSolarTime(Number.NaN), { latitude: 0, longitudeEast: 30 })
        .classification,
    ).toBe('UNAVAILABLE')
  })
})

const render = (variant: ThermalVariant, localTime: Classified<number>) =>
  renderToStaticMarkup(
    <ThermalSettingsView variant={variant} onSelect={() => {}} localTime={localTime} />,
  )

describe('ThermalSettingsView', () => {
  it('marks the chosen mosaic pressed, and only that one', () => {
    const day = render('day', unavailable('fixture'))
    expect(day).toMatch(/aria-pressed="true"[^>]*>Day</)
    expect(day).toMatch(/aria-pressed="false"[^>]*>Night</)
    const night = render('night', unavailable('fixture'))
    expect(night).toMatch(/aria-pressed="false"[^>]*>Day</)
    expect(night).toMatch(/aria-pressed="true"[^>]*>Night</)
  })

  it('shows the local time as a DERIVED hint that never switches', () => {
    const html = render('day', derived(15.5, 'fixture method'))
    expect(html).toContain('15:30')
    expect(html).toContain('DERIVED')
    expect(html).toContain('never switches by itself')
  })

  it('says the local time is unavailable rather than showing a number', () => {
    const html = render('day', unavailable('fixture reason'))
    expect(html).toContain('unavailable')
    expect(html).not.toMatch(/\d\d:\d\d/)
  })

  it('states plainly that no seasonal map exists, marked UNAVAILABLE with the reason', () => {
    const html = render('day', unavailable('fixture'))
    expect(html).toContain('No official seasonal surface-temperature map was found.')
    // A reader cannot look up a tracker number: the reason cites none.
    expect(NO_SEASONAL_MAP_REASON).not.toMatch(/#\d/)
    expect(NO_SEASONAL_MAP_REASON).toContain('model output, not observations')
    expect(html.match(/UNAVAILABLE/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
