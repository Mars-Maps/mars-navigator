import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, isAvailable, official, unavailable, type MarsCoordinate } from '../../src/domain'
import { PointMenuView } from '../../src/features/mission-ui/PointMenu'
import {
  NO_ELEVATION_REASON,
  NO_GEOLOGIC_UNIT_REASON,
  NO_RADIATION_REASON,
  NO_SLOPE_REASON,
  NO_TEMPERATURE_REASON,
  READING_ELEVATION_REASON,
  READING_SLOPE_REASON,
  describePoint,
} from '../../src/features/mission-ui/pointFields'
import { distanceAndBearing } from '../../src/features/route-analysis/distanceAndBearing'

const POINT: MarsCoordinate = { latitude: 10, longitudeEast: 20 }
const DEPARTURE: MarsCoordinate = { latitude: 0, longitudeEast: 0 }

describe('describePoint', () => {
  it("shows the shell's elevation read, the same read the shielding comes from", () => {
    const height = official(-2600, 'HiRISE DTM mosaic of Jezero, 1 m')
    expect(describePoint(POINT, null, { elevation: height }).elevation).toBe(height)
    const missing = unavailable<number>('No height here')
    expect(describePoint(POINT, null, { elevation: missing }).elevation).toBe(missing)
  })

  it('says the elevation is being read while it is, and keeps the old reason where nothing reads it', () => {
    expect(describePoint(POINT, null, { elevation: null }).elevation).toEqual(unavailable(READING_ELEVATION_REASON))
    expect(describePoint(POINT, null).elevation).toEqual(unavailable(NO_ELEVATION_REASON))
  })

  it("shows the shell's slope read as it is: DERIVED with its method, or UNAVAILABLE with the reason", () => {
    // Test fixture only: an invented slope, never shown in the app.
    const slope = derived(8.1, 'fixture-horn-method')
    expect(describePoint(POINT, null, { slope }).slope).toBe(slope)
    const none = unavailable<number>('fixture-no-heights')
    expect(describePoint(POINT, null, { slope: none }).slope).toBe(none)
  })

  it('says the slope is being read while it is, and that it was not read where nothing reads it', () => {
    expect(describePoint(POINT, null, { slope: null }).slope).toEqual(unavailable(READING_SLOPE_REASON))
    expect(describePoint(POINT, null).slope).toEqual(unavailable(NO_SLOPE_REASON))
  })

  it('never shows a figure that is not a slope', () => {
    expect(describePoint(POINT, null, { slope: derived(Number.NaN, 'fixture') }).slope.classification).toBe('UNAVAILABLE')
    expect(describePoint(POINT, null, { slope: derived(-3, 'fixture') }).slope.classification).toBe('UNAVAILABLE')
  })

  it('never gives radiation a value, whatever the inputs', () => {
    // The atmosphere overhead never turns into a dose.
    for (const [departure, shielding] of [
      [null, null],
      [DEPARTURE, derived(0.6, 'fixture-shielding')],
      [POINT, derived(1, 'fixture-shielding')],
    ] as const) {
      const r = describePoint(POINT, departure, { shielding }).radiation.dose
      expect(r.classification).toBe('UNAVAILABLE')
      expect(isAvailable(r)).toBe(false)
      if (!isAvailable(r)) expect(r.reason).toMatch(/no global surface radiation map/i)
    }
  })

  it('leaves elevation, temperature and the geologic unit UNAVAILABLE with a reason', () => {
    const f = describePoint(POINT, DEPARTURE)
    const reasons = [f.elevation, f.temperature.estimate, f.geologicUnit].map((field) =>
      field.classification === 'UNAVAILABLE' ? field.reason : null,
    )
    for (const reason of reasons) {
      expect(reason).not.toBeNull()
      expect(reason?.length).toBeGreaterThan(20)
    }
  })

  it('derives the distance from the departure and states the method', () => {
    const d = describePoint(POINT, DEPARTURE).distanceFromDeparture
    const expected = distanceAndBearing(DEPARTURE, POINT).distanceKm
    expect(d).toEqual(expected)
    expect(d.classification).toBe('DERIVED')
    if (d.classification === 'DERIVED') {
      expect(d.method).toMatch(/Haversine/)
      // 10° N, 20° E from the origin on a 3389.5 km sphere: about 1,300 km.
      expect(d.value).toBeGreaterThan(1200)
      expect(d.value).toBeLessThan(1400)
    }
  })

  it('says UNAVAILABLE, not 0, when no departure is set', () => {
    const d = describePoint(POINT, null).distanceFromDeparture
    expect(d.classification).toBe('UNAVAILABLE')
    if (!isAvailable(d)) expect(d.reason).toMatch(/no departure/i)
  })

  it('gives 0 km, DERIVED, when the point is the departure', () => {
    const d = describePoint(POINT, POINT).distanceFromDeparture
    expect(d.classification).toBe('DERIVED')
    if (isAvailable(d)) expect(d.value).toBeCloseTo(0, 6)
  })

  it('labels the coordinate DERIVED from the pick ray', () => {
    const c = describePoint(POINT, null).coordinate
    expect(c.classification).toBe('DERIVED')
    if (c.classification === 'DERIVED') {
      expect(c.value).toEqual(POINT)
      expect(c.method).toMatch(/pick ray/)
    }
  })
})

describe('PointMenuView', () => {
  const render = (point: MarsCoordinate | null, departure: MarsCoordinate | null) =>
    renderToStaticMarkup(<PointMenuView point={point} departure={departure} />)

  it('asks for a point when none is selected, and shows no fields', () => {
    const html = render(null, DEPARTURE)
    expect(html).toMatch(/No point selected/)
    expect(html).not.toMatch(/Radiation/)
  })

  it('shows every field with a badge, and radiation as unavailable', () => {
    const html = render(POINT, DEPARTURE)
    for (const label of ['Coordinate', 'Elevation', 'Slope', 'Distance from departure', 'Temperature', 'Radiation', 'Geologic unit']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('10.00°N 20.00°E')
    expect(html).toMatch(/DERIVED/)
    expect(html).toMatch(/UNAVAILABLE/)
    expect(html).toMatch(/No global surface radiation map exists/)
    // Six unavailable values, each with its badge, in the list and in the pager:
    // elevation, slope, temperature, the dose and the atmosphere overhead, the unit.
    const [list, pager] = html.split('role="group"')
    expect(list.match(/UNAVAILABLE/g)).toHaveLength(6)
    expect(pager.match(/UNAVAILABLE/g)).toHaveLength(6)
  })

  it('shows the slope right after the elevation, in the stop card’s words and bands', () => {
    // Test fixture only: an invented slope, never shown in the app.
    const html = renderToStaticMarkup(
      <PointMenuView point={POINT} departure={DEPARTURE} pointSlope={derived(8.14, 'fixture-horn-method')} />,
    )
    expect(html).toContain('8.1° moderate')
    expect(html).toContain('fixture-horn-method')
    const list = html.split('role="group"')[0]
    expect(list.indexOf('>Slope<')).toBeGreaterThan(list.indexOf('>Elevation<'))
    expect(list.indexOf('>Slope<')).toBeLessThan(list.indexOf('>Distance from departure<'))
  })

  it('says the slope is being read while the shell reads it', () => {
    const html = renderToStaticMarkup(<PointMenuView point={POINT} departure={DEPARTURE} pointSlope={null} />)
    expect(html).toContain(READING_SLOPE_REASON)
  })

  it('shows the missing departure as unavailable, not as a distance', () => {
    const html = render(POINT, null)
    expect(html).toMatch(/No departure set/)
    expect(html).not.toMatch(/ km</)
  })
})

describe('PointMenuView pager', () => {
  const OPEN_SEARCH = String.raw`in-[.peer\/search:has([aria-expanded=true])~*]:`
  const html = renderToStaticMarkup(<PointMenuView point={POINT} departure={DEPARTURE} />)
  const pager = html.slice(html.indexOf('role="group"'))
  const LABELS = ['Coordinate', 'Elevation', 'Slope', 'Distance from departure', 'Temperature', 'Radiation', 'Geologic unit']

  it('renders the list and the pager, the list hidden and the pager shown while the search bar is open', () => {
    expect(html).toContain(`class="${OPEN_SEARCH}hidden"`)
    expect(html).toContain(`class="hidden ${OPEN_SEARCH}block"`)
    expect(pager).toContain('aria-roledescription="carousel"')
  })

  it('has one page per field, only the first visible to start', () => {
    const pages = [...pager.matchAll(/<dl aria-hidden="(true|false)" class="([^"]*)"><dt[^>]*>([^<]*)</g)]
    expect(pages.map((p) => p[3])).toEqual(LABELS)
    expect(pages.map((p) => p[1])).toEqual(['false', 'true', 'true', 'true', 'true', 'true', 'true'])
    // Only the shown page takes room, so the box fits it: the others are hidden, not stacked.
    expect(pages[0][2]).toBe('')
    expect(pages.slice(1).every((p) => p[2] === 'hidden')).toBe(true)
    expect(pager).not.toContain('grid-area')
    expect(pager).not.toContain('invisible')
  })

  it('has a labelled dot per page, the first current, and both arrows', () => {
    const dots = [...pager.matchAll(/aria-label="([^"]*), field (\d) of 7"/g)]
    expect(dots.map((d) => d[1])).toEqual(LABELS)
    const current = [...pager.matchAll(/<button[^>]*aria-current="true"[^>]*>/g)]
    expect(current).toHaveLength(1)
    expect(current[0][0]).toContain('aria-label="Coordinate, field 1 of 7"')
    expect(pager).toContain('aria-label="Previous field"')
    expect(pager).toContain('aria-label="Next field"')
  })

  it('announces the page through one offscreen live region, not the pages box', () => {
    const live = [...pager.matchAll(/<[^>]*aria-live="polite"[^>]*>([^<]*)</g)]
    expect(live).toHaveLength(1)
    expect(live[0][0]).toContain('sr-only')
    expect(live[0][1]).toBe('Coordinate, 1 of 7')
  })

  it('shows every reason in full in the pager, never cut short', () => {
    expect(html).not.toContain('line-clamp')
    for (const reason of [NO_ELEVATION_REASON, NO_SLOPE_REASON, NO_TEMPERATURE_REASON, NO_RADIATION_REASON, NO_GEOLOGIC_UNIT_REASON]) {
      expect(pager).toContain(`>${reason}<`)
    }
  })
})
