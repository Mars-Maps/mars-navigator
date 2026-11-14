import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createWalkPlanner } from '../../src/app/walkPlanner'
import {
  HAZARD_NOT_CHECKED,
  MARS_MEAN_RADIUS_KM,
  SUITED_SLOPE_LIMIT,
  derived,
  official,
  unavailable,
  walkPlanProblem,
  type Classified,
  type GeologicFeatures,
  type GeologicMap,
  type MarsCoordinate,
  type MarsSolarTime,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import { SurfaceHud } from '../../src/features/mission-ui/hud/SurfaceHud'
import { hudStops } from '../../src/features/mission-ui/hud/hudMath'
import { formatSlope } from '../../src/features/mission-ui/slopeLimit'
import type { SlopeModel } from '../../src/features/route-analysis/pointSlope'
import type { WalkHeights } from '../../src/features/route-analysis/walkLegs'

/**
 * The first check: the HUD's values match the planner's for
 * the same route. The legs come from the shell's own planner
 * (over `walkLegs`), not from hand-written `WalkLeg`s, so a change in
 * what the planner returns shows here. Test fixtures only: invented ground
 * near Jezero, never shown.
 */
const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(START.latitude * RAD)

/** x km east of START. */
const at = (x: number): MarsCoordinate => ({ latitude: START.latitude, longitudeEast: START.longitudeEast + x / KM_PER_DEG_LON })
const stop = (id: string, x: number): WalkStop => ({
  id,
  label: `Stop ${id}`,
  coordinate: at(x),
  unit: unavailable('fixture'),
  reason: derived('fixture', 'fixture'),
})

const GLOBAL: SlopeModel = { cellKm: 0.2, source: 'fixture global', site: false }

/**
 * Flat to 2 km east, then a 25° rise to 4 km, then no heights at all: the
 * three cases the HUD must carry over unchanged (under the limit, over it,
 * not checked). Each height is its 0.2 km cell's centre, as the chain answers.
 */
const ground: WalkHeights = (points) => {
  const n = points.length / 2
  const heights = new Float32Array(n)
  const model = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const x = (points[i * 2 + 1] - START.longitudeEast) * KM_PER_DEG_LON
    const cx = Math.round(x / GLOBAL.cellKm) * GLOBAL.cellKm
    heights[i] = cx > 4 + 1e-9 ? NaN : -2500 + Math.max(0, cx - 2) * 1000 * Math.tan(25 * RAD)
  }
  return Promise.resolve(official({ heights, model, models: [GLOBAL] }, 'fixture chain'))
}

const STOPS = [stop('a', 0), stop('b', 2), stop('c', 4), stop('d', 6)]

const MAP: GeologicMap = { id: 'SIM fixture', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }
const READ_MAP = official<GeologicFeatures>({ points: [], lines: [], areas: [] }, 'fixture map')

/**
 * The shell's planner over the fixture ground. Its legs step is
 * the one the walk panel runs, so the HUD is checked against what the panel
 * shows, not against a second call of `walkLegs`. Stops are fixed here
 * rather than picked from units, so each leg lands on a known stretch.
 */
const planner = (features: Classified<GeologicFeatures>) =>
  createWalkPlanner({
    site: { name: 'Fixture crater', map: MAP, bounds: { west: 77, east: 78, south: 18, north: 19 } },
    units: () => Promise.resolve(unavailable('fixture: stops are fixed')),
    unitAt: () => Promise.resolve(unavailable('fixture: stops are fixed')),
    features: () => Promise.resolve(features),
    heights: ground,
    cellKmAlong: () => GLOBAL.cellKm,
    traverse: async () => unavailable('fixture: the rover path is not read here'),
  })

async function plannedWalk(features: Classified<GeologicFeatures> = READ_MAP, stops: WalkStop[] = STOPS): Promise<WalkPlan> {
  const legs = await planner(features).walkLegs(stops, new AbortController().signal)
  return {
    goal: { id: 'g', label: 'fixture goal', unitNames: ['fixture unit'], reason: derived('fixture', 'fixture') },
    stops,
    legs,
    slopeLimit: SUITED_SLOPE_LIMIT,
  }
}

const SOLAR = derived<MarsSolarTime>(
  {
    marsSolDate: 50000,
    coordinatedMarsTimeHours: 12,
    solarLongitudeDeg: 100,
    equationOfTimeDeg: 0,
    heliocentricDistanceAu: 1.52,
    subsolarPoint: { latitude: 0, longitudeEast: 0 },
  },
  'fixture-mars24',
)

/** The HUD as the walker sees it from stop a, aimed at `plan.stops[aimed]`. */
const renderHud = (plan: WalkPlan, aimed: number) =>
  renderToStaticMarkup(
    <SurfaceHud
      heading={derived(270, 'fixture-heading')}
      position={derived(STOPS[0].coordinate, 'fixture-position')}
      stops={hudStops(plan)}
      slopeLimit={plan.slopeLimit}
      activeStopIndex={aimed}
      onGoToStop={() => {}}
      sunElevationDeg={derived(30, 'fixture-sky')}
      solar={SOLAR}
    />,
  )

/** As `renderToStaticMarkup` writes text and attributes. */
const escaped = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

/** What the HUD must show for a slope: the planner's figure and method, or its reason. */
const planners = (slope: Classified<number>) =>
  slope.classification === 'UNAVAILABLE'
    ? [escaped(slope.reason)]
    : slope.classification === 'DERIVED'
      ? [escaped(formatSlope(slope.value)), escaped(slope.method)]
      : []

describe('HUD against the planner’s own legs', () => {
  it('is a plan the shared store accepts', async () => {
    expect(walkPlanProblem(await plannedWalk())).toBeNull()
  })

  it('gives each stop the leg into it, unchanged', async () => {
    const plan = await plannedWalk()
    const stops = hudStops(plan)
    expect(stops.map((s) => s.label)).toEqual(STOPS.map((s) => s.label))
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].steepestSlopeDeg).toBe(plan.legs[i - 1].steepestSlopeDeg)
      expect(stops[i].legHazards).toBe(plan.legs[i - 1].hazards)
    }
  })

  it('shows a flat leg’s slope and method as the planner gives them, with no flag', async () => {
    const plan = await plannedWalk()
    const slope = plan.legs[0].steepestSlopeDeg
    expect(slope.classification).toBe('DERIVED')
    const html = renderHud(plan, 1)
    for (const text of planners(slope)) expect(html).toContain(text)
    expect(html).not.toContain('data-over-limit')
  })

  it('flags the steep leg with the planner’s figure, the limit’s label and its citation', async () => {
    const plan = await plannedWalk()
    const slope = plan.legs[1].steepestSlopeDeg
    expect(slope.classification === 'DERIVED' && slope.value > SUITED_SLOPE_LIMIT.deg).toBe(true)
    const html = renderHud(plan, 2)
    for (const text of planners(slope)) expect(html).toContain(text)
    expect(html).toContain('data-over-limit')
    expect(html).toContain(escaped(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`))
    expect(html).toContain(escaped(SUITED_SLOPE_LIMIT.source))
  })

  it('shows ground the planner did not check as unavailable with its reason, never as a slope', async () => {
    const plan = await plannedWalk()
    const slope = plan.legs[2].steepestSlopeDeg
    expect(slope.classification).toBe('UNAVAILABLE')
    const html = renderHud(plan, 3)
    for (const text of planners(slope)) expect(html).toContain(text)
    expect(html).not.toContain('data-over-limit')
    expect(html).not.toMatch(/0\.0° gentle/)
  })

  it('flags a leg that is part over the limit and part not checked, its slope still unavailable', async () => {
    // 2 km to 5 km east: the 25° rise, then 1 km with no heights.
    const plan = await plannedWalk(READ_MAP, [stop('a', 0), stop('b', 2), stop('e', 5)])
    const leg = plan.legs[1]
    expect(leg.steepestSlopeDeg.classification).toBe('UNAVAILABLE')
    const over =
      leg.hazards.classification === 'DERIVED'
        ? leg.hazards.value.filter((h) => h.kind === 'slope' && h.magnitude.classification === 'DERIVED' && h.magnitude.value > SUITED_SLOPE_LIMIT.deg)
        : []
    expect(over.length).toBeGreaterThan(0)
    const html = renderHud(plan, 2)
    for (const text of planners(leg.steepestSlopeDeg)) expect(html).toContain(text)
    expect(html).toContain('data-over-limit')
    expect(html).toContain(escaped(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`))
  })

  it('keeps an unread map off the HUD as a warning: no radiation glyph, no "not checked" figure', async () => {
    const plan = await plannedWalk(unavailable('fixture: map service down'))
    expect(walkPlanProblem(plan)).toBeNull()
    const hazards = plan.legs[0].hazards
    // The planner says so on the leg, as a hazard with no figure.
    expect(hazards.classification === 'DERIVED' && hazards.value.some((h) => h.unit === HAZARD_NOT_CHECKED)).toBe(true)
    // The slope still matches the planner's: the map is a separate check.
    const html = renderHud(plan, 1)
    for (const text of planners(plan.legs[0].steepestSlopeDeg)) expect(html).toContain(text)
    expect(html).not.toContain('data-radiation-warning')
    // The HUD names no mapped obstacle (the walk panel's leg detail does), so the hazard's words stay out.
    const notChecked = hazards.classification === 'DERIVED' ? hazards.value.find((h) => h.unit === HAZARD_NOT_CHECKED) : undefined
    expect(notChecked?.magnitude.classification).toBe('UNAVAILABLE')
    if (notChecked?.magnitude.classification === 'UNAVAILABLE') expect(html).not.toContain(escaped(notChecked.magnitude.reason))
  })
})
