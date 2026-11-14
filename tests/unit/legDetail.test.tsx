import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  HAZARD_NOT_CHECKED,
  RADIATION_HAZARD_UNIT,
  SHIELDING_WARNING_TEXT,
  derived,
  unavailable,
  type Hazard,
  type MarsCoordinate,
  type WalkLeg,
} from '../../src/domain'
import { RadiationHudGlyph } from '../../src/features/mission-ui/radiation/RadiationWarning'
import { LegDetail } from '../../src/features/mission-ui/walk/LegDetail'

// Test fixtures only: invented legs and hazards near Jezero, never shown in the app.
const AT: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.4 }
const leg = (over: Partial<WalkLeg>): WalkLeg => ({
  fromStopId: 'a',
  toStopId: 'b',
  path: derived([AT, AT], 'fixture'),
  distanceKm: derived(1, 'fixture'),
  steepestSlopeDeg: derived(12.34, 'fixture slope method'),
  hazards: derived([], 'fixture scan method'),
  ...over,
})
const flagged = (hazards: Hazard[]) => leg({ hazards: derived(hazards, 'fixture scan method') })
const render = (l: WalkLeg) => renderToStaticMarkup(<LegDetail leg={l} limitDeg={20} />)
const slope = (deg: number): Hazard => ({ id: 's', kind: 'slope', unit: '°', coordinate: AT, magnitude: derived(deg, 'fixture') })
const mapped = (unit: string, reason: string): Hazard => ({
  id: 'm',
  kind: 'mapped-obstacle',
  unit,
  coordinate: AT,
  magnitude: unavailable(reason),
})

describe('LegDetail', () => {
  it('gives the steepest slope with its method, and says none flagged, never safe', () => {
    const html = render(leg({}))
    expect(html).toContain('12.3°')
    expect(html).toContain('fixture slope method')
    expect(html).toContain('None flagged')
    expect(html).toContain('fixture scan method')
    expect(html).not.toMatch(/safe|clear/i)
    expect(html).not.toContain('over 20°')
  })

  it('says a steepest slope is over the limit only when it is', () => {
    expect(render(leg({ steepestSlopeDeg: derived(33.3, 'fixture') }))).toContain('over 20°')
    expect(render(leg({ steepestSlopeDeg: derived(20, 'fixture') }))).not.toContain('over 20°')
  })

  it('shows a steepest slope nobody measured as unavailable, with the reason, not 0', () => {
    const html = render(leg({ steepestSlopeDeg: unavailable('fixture: 200 m not checked') }))
    expect(html).toContain('unavailable')
    expect(html).toContain('fixture: 200 m not checked')
    expect(html).not.toContain('0.0°')
    expect(html).not.toContain('over 20°')
  })

  it('shows a slope flag with its figure and where it is', () => {
    const html = render(flagged([slope(33.3)]))
    expect(html).toContain('Steep slope')
    expect(html).toContain('33.3°')
    expect(html).toContain('18.440°N 77.400°E')
    expect(html).not.toContain('None flagged')
  })

  it('says a stretch of slope was not checked, with the planner’s reason', () => {
    const notChecked: Hazard = { ...slope(0), magnitude: unavailable('fixture: a model switch') }
    const html = render(flagged([notChecked]))
    expect(html).toContain('Slope not checked')
    expect(html).toContain('fixture: a model switch')
    expect(html).not.toContain('Steep slope')
  })

  it('names a mapped obstacle in the map’s own wording, its reason in the mark, with no size', () => {
    const html = render(flagged([mapped('delta lobe front', 'fixture: the leg crosses a line')]))
    expect(html).toContain('On the map: delta lobe front')
    expect(html).toContain('fixture: the leg crosses a line')
    expect(html).toContain('18.440°N 77.400°E')
    expect(html).not.toContain('unavailable delta')
  })

  it('says the map was not checked when it could not be read', () => {
    const html = render(flagged([mapped(HAZARD_NOT_CHECKED, 'fixture: the service is down')]))
    expect(html).toContain('Mapped obstacles not checked')
    expect(html).toContain('fixture: the service is down')
    expect(html).not.toContain('On the map')
  })

  it('says how far the leg stays from the rover path, with the method, never safe', () => {
    const html = render(leg({ farthestFromRoverPathM: derived(1260, 'fixture distance method') }))
    expect(html).toContain('Whole leg')
    expect(html).toContain('within 1.3 km of the rover path')
    expect(html).toContain('fixture distance method')
    expect(html).not.toMatch(/safe|clear/i)
  })

  it('says the distance is unavailable with the reason, never 0', () => {
    const html = render(leg({ farthestFromRoverPathM: unavailable('fixture: the feed answered 503') }))
    expect(html).toContain('Distance from the rover path')
    expect(html).toContain('unavailable')
    expect(html).toContain('fixture: the feed answered 503')
    expect(html).not.toContain('within')
  })

  it('shows no rover path row for a plan that did not measure it', () => {
    expect(render(leg({}))).not.toMatch(/rover path|Whole leg/)
  })

  const radiation = (magnitude: Hazard['magnitude']): Hazard => ({
    id: 'r',
    kind: 'radiation',
    unit: RADIATION_HAZARD_UNIT,
    coordinate: AT,
    magnitude,
  })

  it('warns of low shielding only where there is a figure for it', () => {
    const html = render(flagged([radiation(derived(0.7, 'fixture'))]))
    expect(html).toContain(SHIELDING_WARNING_TEXT)
    expect(html).toContain('Highest point')
  })

  it('says radiation was not checked on ground with no height, not a warning or a highest point', () => {
    const html = render(flagged([radiation(unavailable('fixture: no height here'))]))
    expect(html).toContain('Radiation not checked')
    expect(html).toContain('fixture: no height here')
    expect(html).not.toContain(SHIELDING_WARNING_TEXT)
    expect(html).not.toContain('Highest point')
  })

  it('shows the HUD glyph for a figure under the line, not for ground with no height', () => {
    const glyph = (h: Hazard) => renderToStaticMarkup(<RadiationHudGlyph nextLegHazards={derived([h], 'fixture')} />)
    expect(glyph(radiation(derived(0.7, 'fixture')))).not.toBe('')
    expect(glyph(radiation(unavailable('fixture: no height here')))).toBe('')
  })

  it('shows a leg whose flags could not be worked out as unavailable, not as none', () => {
    const html = render(leg({ hazards: unavailable('fixture: no scan') }))
    expect(html).toContain('fixture: no scan')
    expect(html).not.toContain('None flagged')
  })
})
