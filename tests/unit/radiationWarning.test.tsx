import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  RADIATION_HAZARD_UNIT,
  RADIATION_LEVEL_BASIS,
  RADIATION_LEVEL_TEXT,
  SHIELDING_WARNING_BASIS,
  SHIELDING_WARNING_FRACTION,
  SHIELDING_WARNING_TEXT,
  derived,
  isAvailable,
  unavailable,
  type Hazard,
  type MarsCoordinate,
  type OtherHazard,
  type RadiationHazard,
  type RouteOption,
  type RouteRequest,
} from '../../src/domain'
import { planRouteOptions } from '../../src/app/planRoute'
import { GALE_RAD_REFERENCE } from '../../src/data/radiation/galeRadReference'
import { PointMenuView } from '../../src/features/mission-ui/PointMenu'
import { HazardsPanel } from '../../src/features/mission-ui/navigation/HazardsPanel'
import {
  NO_RADIATION_REASON,
  NO_SHIELDING_REASON,
  formatShielding,
  radiationHazards,
  readRadiation,
} from '../../src/features/mission-ui/radiation/radiationMath'
import {
  RadiationField,
  RadiationHazardNote,
  SHIELDING_WARNING_SHORT,
  RadiationHudGlyph,
} from '../../src/features/mission-ui/radiation/RadiationWarning'
import { methodologyText, shownMarkup, visibleText } from './methodology.helpers'

// Test fixtures only — invented shielding values, hazards and coordinates.
const AT: MarsCoordinate = { latitude: 18.5, longitudeEast: 77.4 }
const f = (value: number) => derived(value, 'fixture-shielding')
const radiationHazard = (over: Partial<RadiationHazard> = {}): RadiationHazard => ({
  id: 'fixture-radiation',
  kind: 'radiation',
  coordinate: AT,
  magnitude: f(0.68),
  unit: RADIATION_HAZARD_UNIT,
  ...over,
})
const otherHazard = (kind: OtherHazard['kind'], over: Partial<OtherHazard> = {}): OtherHazard => ({
  id: `fixture-${kind}`,
  kind,
  coordinate: AT,
  magnitude: derived(24, 'fixture-slope'),
  unit: 'deg',
  ...over,
})
const RADIATION = radiationHazard()
const SLOPE = otherHazard('slope')

const REQUEST: RouteRequest = { departure: { latitude: 0, longitudeEast: 0 }, stops: [], destination: AT }
const route = planRouteOptions(REQUEST).find((o) => o.strategy === 'shortest')!
const withHazards = (hazards: RouteOption['hazards']): RouteOption => ({ ...route, hazards })

describe('readRadiation', () => {
  it('keeps the dose UNAVAILABLE with its reason, whatever the shielding', () => {
    for (const s of [null, f(0.5), f(1), unavailable<number>('fixture')]) {
      expect(readRadiation(s).dose).toEqual(unavailable(NO_RADIATION_REASON))
    }
  })

  it("warns only under the domain's line, and never while the shielding is unknown", () => {
    expect(SHIELDING_WARNING_FRACTION).toBe(0.8)
    expect(readRadiation(f(0.6)).warn).toBe(true)
    // The Jezero rim crests: just under the line warns, on it does not.
    expect(readRadiation(f(0.79)).warn).toBe(true)
    expect(readRadiation(f(SHIELDING_WARNING_FRACTION)).warn).toBe(false)
    // About Jezero's floor: under Gale's column, but not under the threshold.
    expect(readRadiation(f(0.84)).warn).toBe(false)
    expect(readRadiation(null).warn).toBe(false)
    expect(readRadiation(unavailable('fixture')).warn).toBe(false)
  })

  it('reads the level on the same fraction, HIGH exactly where it warns, and none while unknown', () => {
    expect(readRadiation(f(0.6)).level).toBe('HIGH')
    expect(readRadiation(f(0.79)).level).toBe('HIGH')
    expect(readRadiation(f(SHIELDING_WARNING_FRACTION)).level).toBe('MEDIUM')
    expect(readRadiation(f(0.84)).level).toBe('MEDIUM')
    expect(readRadiation(f(0.99)).level).toBe('MEDIUM')
    expect(readRadiation(f(1)).level).toBe('LOW')
    expect(readRadiation(f(1.13)).level).toBe('LOW')
    expect(readRadiation(null).level).toBeNull()
    expect(readRadiation(unavailable('fixture')).level).toBeNull()
    expect(readRadiation(f(Number.NaN)).level).toBeNull()
    for (const s of [0.5, 0.79, 0.8, 0.84, 1, 1.2]) {
      const r = readRadiation(f(s))
      expect(r.warn).toBe(r.level === 'HIGH')
    }
  })

  it('says why the shielding is unknown, never 0', () => {
    expect(readRadiation(null).shielding).toEqual(unavailable(NO_SHIELDING_REASON))
    const nan = readRadiation(f(Number.NaN))
    expect(isAvailable(nan.shielding)).toBe(false)
    expect(nan.warn).toBe(false)
  })

  it('writes the fraction with two decimals, so 0.79 and the 0.80 line differ', () => {
    expect(formatShielding(0.79)).toBe("0.79 of Gale's")
    expect(formatShielding(0.8)).toBe("0.80 of Gale's")
  })

  it('rounds down, so a fraction that warns never reads 0.80', () => {
    expect(formatShielding(0.796)).toBe("0.79 of Gale's")
    expect(formatShielding(0.799)).toBe("0.79 of Gale's")
    expect(formatShielding(0.7999)).toBe("0.79 of Gale's")
  })

  it('keeps exact two-decimal fractions whole despite floating point', () => {
    expect(formatShielding(0.29)).toBe("0.29 of Gale's")
    expect(formatShielding(0.57)).toBe("0.57 of Gale's")
    expect(formatShielding(1.13)).toBe("1.13 of Gale's")
  })
})

describe('radiation hazards', () => {
  it('picks the radiation hazards from a scanned list, and none from an unscanned one', () => {
    expect(radiationHazards(derived([SLOPE, RADIATION], 'fixture-scan'))).toEqual([RADIATION])
    expect(radiationHazards(derived([SLOPE], 'fixture-scan'))).toEqual([])
    expect(radiationHazards(unavailable('fixture-not-scanned'))).toEqual([])
  })
})

describe('the warning in each place', () => {
  const pointMenu = (shielding: number | null) =>
    renderToStaticMarkup(
      <PointMenuView point={AT} departure={null} radiationShielding={shielding === null ? null : f(shielding)} />,
    )
  const panel = (hazards: Hazard[]) => renderToStaticMarkup(<HazardsPanel route={withHazards(derived(hazards, 'fixture-scan'))} />)
  const hud = (hazards: RouteOption['hazards']) => renderToStaticMarkup(<RadiationHudGlyph nextLegHazards={hazards} />)

  it('point menu: dose UNAVAILABLE, the atmosphere overhead DERIVED, and the warning under the line', () => {
    const html = pointMenu(0.6)
    expect(html).toContain('>Dose<')
    expect(html).toContain(NO_RADIATION_REASON)
    expect(html).toContain(">Atmosphere overhead<")
    expect(html).toContain("0.60 of Gale&#x27;s")
    expect(html).toContain('fixture-shielding')
    // In the list and in the pager.
    expect(html.match(/data-radiation-warning/g)).toHaveLength(2)
    expect(html).toContain(SHIELDING_WARNING_TEXT)
    // The line is named as a project choice, not an agency limit.
    expect(html).toContain(SHIELDING_WARNING_BASIS)
  })

  it('point menu: the level word beside the fraction, with its basis; none while unknown', () => {
    const high = pointMenu(0.6)
    expect(high).toContain('data-radiation-level="HIGH"')
    expect(high).toMatch(/data-radiation-level="HIGH"[^>]*class="[^"]*text-danger/)
    // The markup escapes the apostrophe in "Gale's".
    expect(high).toContain(RADIATION_LEVEL_BASIS.replace("'", '&#x27;'))
    const medium = pointMenu(0.84)
    expect(medium).toContain('data-radiation-level="MEDIUM"')
    expect(medium).toContain("0.84 of Gale&#x27;s")
    expect(medium).toContain(RADIATION_LEVEL_TEXT.MEDIUM)
    expect(medium).not.toMatch(/data-radiation-level="MEDIUM"[^>]*text-danger/)
    const low = pointMenu(1.13)
    expect(low).toContain('data-radiation-level="LOW"')
    expect(low).toContain(RADIATION_LEVEL_TEXT.LOW)
    expect(pointMenu(null)).not.toContain('data-radiation-level=')
    // The level is a shielding scale: nothing says "safe".
    expect([high, medium, low].join()).not.toMatch(/\bsafe\b/i)
  })

  it('point menu: no warning on or above the line, or while unknown', () => {
    expect(pointMenu(0.84)).not.toContain('data-radiation-warning')
    expect(pointMenu(SHIELDING_WARNING_FRACTION)).not.toContain('data-radiation-warning')
    expect(pointMenu(0.84)).not.toContain('data-radiation-basis')
    const unknown = pointMenu(null)
    expect(unknown).not.toContain('data-radiation-warning')
    expect(unknown).toContain(NO_SHIELDING_REASON)
  })

  it("hazards panel: a radiation hazard in the rule's words, with the highest point, the level and the fraction", () => {
    const html = panel([SLOPE, RADIATION])
    expect(html).toContain(SHIELDING_WARNING_TEXT)
    expect(html).toContain('data-radiation-level="HIGH"')
    expect(html).toContain('Highest point 18.5°N 77.4°E')
    expect(html).toContain("0.68 of Gale&#x27;s")
    // The fraction is formatted, never printed with its raw unit name.
    expect(html).not.toContain(RADIATION_HAZARD_UNIT)
    // Other kinds keep their row: coordinate and magnitude with its unit.
    expect(html).toContain('24.0 deg')
    expect(html.match(/data-radiation-warning/g)).toHaveLength(1)
  })

  it('hazards panel: no warning without a radiation hazard', () => {
    expect(panel([SLOPE])).not.toContain('data-radiation-warning')
  })

  it('stop card note: the same words, point and fraction', () => {
    const html = renderToStaticMarkup(<RadiationHazardNote hazard={RADIATION} />)
    expect(html).toContain(SHIELDING_WARNING_TEXT)
    expect(html).toContain('Highest point')
    expect(html).toContain("0.68 of Gale&#x27;s")
  })

  it('HUD: one glyph when the next leg carries the hazard, named for a screen reader', () => {
    const html = hud(derived([SLOPE, RADIATION, radiationHazard({ id: 'fixture-2' })], 'fixture-scan'))
    expect(html.match(/<svg/g)).toHaveLength(1)
    expect(html).toMatch(/role="img" aria-label="Radiation HIGH on the next leg: less atmospheric shielding than at Gale/)
  })

  it('HUD: nothing without the hazard, or before the leg is scanned', () => {
    expect(hud(derived([SLOPE], 'fixture-scan'))).toBe('')
    expect(hud(derived([], 'fixture-scan'))).toBe('')
    expect(hud(unavailable('fixture-not-scanned'))).toBe('')
  })

  it('point menu: the dose, the atmosphere overhead and the warning on show; the Gale reference in the methodology', () => {
    const html = renderToStaticMarkup(
      <PointMenuView point={AT} departure={null} radiationReference={GALE_RAD_REFERENCE} radiationShielding={f(0.6)} />,
    )
    const list = html.split('role="group"')[0]
    const order = ['>Dose<', '>Atmosphere overhead<', 'data-radiation-warning', 'data-methodology=""', 'data-radiation-reference'].map((s) =>
      list.indexOf(s),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(shownMarkup(list)).not.toContain('data-radiation-reference')
    // The warning is a few words; the rule's whole sentence and its basis are one click away.
    expect(visibleText(list)).toContain(SHIELDING_WARNING_SHORT)
    expect(visibleText(list)).not.toContain('project choice')
    expect(methodologyText(list)).toContain(SHIELDING_WARNING_TEXT)
    expect(methodologyText(list)).toContain(SHIELDING_WARNING_BASIS)
    expect(methodologyText(list)).toContain(RADIATION_LEVEL_BASIS)
  })

  it('gives mSv only inside the Gale measurement, never for the point', () => {
    const html = renderToStaticMarkup(
      <PointMenuView point={AT} departure={null} radiationReference={GALE_RAD_REFERENCE} radiationShielding={f(0.6)} />,
    )
    // The measurement (OFFICIAL, cited) is in the methodology; nothing on show has a dose unit.
    expect(methodologyText(html)).toMatch(/Measured at Gale crater.*mSv/)
    expect(visibleText(html)).not.toMatch(/mSv|mGy/)
    expect(html).not.toMatch(/higher dose/i)
  })

  it('never says "higher dose" or gives a dose in mSv, anywhere', () => {
    const everywhere = [
      pointMenu(0.6),
      pointMenu(null),
      panel([RADIATION]),
      renderToStaticMarkup(<RadiationHazardNote hazard={RADIATION} />),
      renderToStaticMarkup(<RadiationField reading={readRadiation(f(0.5))} />),
      hud(derived([RADIATION], 'fixture-scan')),
    ].join('\n')
    expect(everywhere).not.toMatch(/higher dose/i)
    expect(everywhere).not.toMatch(/mSv|sievert|gray\b|\bGy\b/i)
  })
})
