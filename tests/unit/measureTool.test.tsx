import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { formatMarsCoordinate, type MarsCoordinate } from '../../src/domain'
import { isMeasureClick, MEASURE_CLICK_MAX_PX, menuOpenAtPress } from '../../src/features/mars-3d/measureClick'
import { MEASURE_POINT_METHOD, MeasurePanelView } from '../../src/features/mission-ui/tools/MeasurePanel'
import { findTool } from '../../src/features/mission-ui/tools/registry'
import { distanceAndBearing } from '../../src/features/route-analysis/distanceAndBearing'
import { nextMeasurePoints, useMeasure } from '../../src/state'

// Fixture coordinates only: two points near Gale and Jezero, rounded.
const A: MarsCoordinate = { latitude: -5.4, longitudeEast: 137.8 }
const B: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.5 }
const C: MarsCoordinate = { latitude: 0, longitudeEast: 0 }

describe('nextMeasurePoints', () => {
  it('takes A, then B, then starts again at the third click', () => {
    expect(nextMeasurePoints([], A)).toEqual([A])
    expect(nextMeasurePoints([A], B)).toEqual([A, B])
    expect(nextMeasurePoints([A, B], C)).toEqual([C])
  })
})

describe('the measure store', () => {
  afterEach(() => useMeasure.getState().clearMeasure())

  it('adds clicks in order and clears', () => {
    const { addMeasurePoint } = useMeasure.getState()
    addMeasurePoint(A)
    addMeasurePoint(B)
    expect(useMeasure.getState().points).toEqual([A, B])
    useMeasure.getState().clearMeasure()
    expect(useMeasure.getState().points).toEqual([])
  })

  it('leaves an empty store as it is when cleared, so nothing re-renders', () => {
    const before = useMeasure.getState()
    before.clearMeasure()
    expect(useMeasure.getState()).toBe(before)
  })
})

describe('isMeasureClick', () => {
  const plain = { deltaPx: 0, clickCount: 1, closedMenu: false }

  it('counts a still pointer as a click and a drag as not', () => {
    expect(isMeasureClick(plain)).toBe(true)
    expect(isMeasureClick({ ...plain, deltaPx: MEASURE_CLICK_MAX_PX })).toBe(true)
    expect(isMeasureClick({ ...plain, deltaPx: MEASURE_CLICK_MAX_PX + 1 })).toBe(false)
    expect(isMeasureClick({ ...plain, deltaPx: Number.NaN })).toBe(false)
  })

  it("ignores a double-click's second click, so it cannot set B on A", () => {
    expect(isMeasureClick({ ...plain, clickCount: 2 })).toBe(false)
    expect(isMeasureClick({ ...plain, clickCount: 3 })).toBe(false)
  })

  it('ignores the press that dismissed the right-click menu', () => {
    expect(isMeasureClick({ ...plain, closedMenu: true })).toBe(false)
  })
})

describe('menuOpenAtPress', () => {
  // Test fixture only: a menu's coordinate and anchor.
  const menu = { coordinate: { latitude: 0, longitudeEast: 0 }, anchor: { x: 10, y: 10 } }

  it('is true while the right-click menu or the Set point chooser is open', () => {
    expect(menuOpenAtPress({ contextMenu: menu, setPointChooser: null })).toBe(true)
    expect(menuOpenAtPress({ contextMenu: null, setPointChooser: menu })).toBe(true)
  })

  it('is false with neither open, so a plain click still sets a point', () => {
    expect(menuOpenAtPress({ contextMenu: null, setPointChooser: null })).toBe(false)
  })
})

describe('MeasurePanelView', () => {
  const render = (points: MarsCoordinate[]) =>
    renderToStaticMarkup(<MeasurePanelView points={points} onClear={() => {}} />)

  it('asks for point A, with no value and no Clear', () => {
    const html = render([])
    expect(html).toContain('Click the surface to set point A.')
    expect(html).not.toContain('Clear')
    expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/\d/)
  })

  it('shows A and asks for B', () => {
    const html = render([A])
    expect(html).toContain(formatMarsCoordinate(A, 2))
    // The point is DERIVED from the pick, with its method.
    expect(html).toContain(MEASURE_POINT_METHOD)
    expect(html).toContain('Click a second point.')
    expect(html).not.toContain('Distance')
  })

  it('shows the distance and bearing distanceAndBearing gives, both DERIVED', () => {
    const html = render([A, B])
    const { distanceKm, initialBearingDeg } = distanceAndBearing(A, B)
    if (distanceKm.classification !== 'DERIVED' || initialBearingDeg.classification !== 'DERIVED') {
      throw new Error('fixture points must have a distance and a direction')
    }
    expect(html).toContain(`${distanceKm.value.toFixed(2)} km`)
    expect(html).toContain(`${initialBearingDeg.value.toFixed(1)}°`)
    expect(html.match(/DERIVED/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain(distanceKm.method)
    expect(html).toContain('Clear')
  })

  it('says the bearing is unavailable for the same point twice, never 0°', () => {
    const html = render([A, A])
    expect(html).toContain('0.00 km')
    expect(html).toContain('Points are identical; no direction')
    expect(html).not.toContain('0.0°')
  })
})

describe('the Measure tool', () => {
  it('is built: a panel, no placeholder', () => {
    const tool = findTool('measure')
    expect(tool?.Panel).toBeDefined()
    expect(tool?.notBuilt).toBeUndefined()
  })
})
