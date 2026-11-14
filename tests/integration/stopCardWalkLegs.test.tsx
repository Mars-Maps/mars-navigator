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
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import { StopCard } from '../../src/features/mission-ui/stops/StopCard'
import { formatDistanceM, stopPlanFacts } from '../../src/features/mission-ui/stops/stopCardMath'
import type { SlopeModel } from '../../src/features/route-analysis/pointSlope'
import type { WalkHeights } from '../../src/features/route-analysis/walkLegs'

/**
 * The stop card against the planner's own legs: what the card takes
 * from a leg, its distance, steepest slope and hazards, comes from the shell's planner
 * (over `walkLegs`), not hand-written `WalkLeg`s. Test
 * fixtures only: invented ground near Jezero, never shown.
 */
const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LON = MARS_MEAN_RADIUS_KM * RAD * Math.cos(START.latitude * RAD)

/** x km east of START. */
const at = (x: number): MarsCoordinate => ({ latitude: START.latitude, longitudeEast: START.longitudeEast + x / KM_PER_DEG_LON })
const stop = (id: string, x: number): WalkStop => ({
  id,
  label: `Stop ${id}`,
  coordinate: at(x),
  unit: unavailable('fixture-unit'),
  reason: derived('fixture-reason', 'fixture'),
})

const GLOBAL: SlopeModel = { cellKm: 0.2, source: 'fixture global', site: false }

/**
 * Flat to 2 km east, then a 25° rise: a leg under the limit and one the planner flags.
 * Low enough that the rise stays under the shielding line, so the steep leg carries no radiation hazard.
 */
const ground: WalkHeights = (points) => {
  const n = points.length / 2
  const heights = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (points[i * 2 + 1] - START.longitudeEast) * KM_PER_DEG_LON
    const cx = Math.round(x / GLOBAL.cellKm) * GLOBAL.cellKm
    heights[i] = -4000 + Math.max(0, cx - 2) * 1000 * Math.tan(25 * RAD)
  }
  return Promise.resolve(official({ heights, model: new Uint8Array(n), models: [GLOBAL] }, 'fixture chain'))
}

/** a → b flat, b → c steep, c → d at the same place: no line to walk. */
const STOPS = [stop('a', 0), stop('b', 2), stop('c', 4), stop('d', 4)]

const MAP: GeologicMap = { id: 'SIM fixture', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }
const READ_MAP = official<GeologicFeatures>({ points: [], lines: [], areas: [] }, 'fixture map')

/**
 * The shell's planner over the fixture ground: its legs step is the one the
 * walk panel runs. Stops are fixed here rather than picked from units, so
 * each leg lands on a known stretch.
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

async function plannedWalk(features: Classified<GeologicFeatures> = READ_MAP): Promise<WalkPlan> {
  const legs = await planner(features).walkLegs(STOPS, new AbortController().signal)
  return {
    goal: { id: 'g', label: 'fixture goal', unitNames: ['fixture unit'], reason: derived('fixture', 'fixture') },
    stops: STOPS,
    legs,
    slopeLimit: SUITED_SLOPE_LIMIT,
  }
}

/** The card for stop `index` as the host would build it: the plan's part from `stopPlanFacts`. */
function renderCard(plan: WalkPlan, index: number) {
  const facts = stopPlanFacts(plan, index)
  if (facts === null) throw new Error(`No stop ${index}`)
  return renderToStaticMarkup(
    <StopCard
      {...facts}
      elevationM={derived(-2500, 'fixture-elevation')}
      slopeDeg={derived(3, 'fixture-slope')}
      photos={[]}
      photoRadiusM={200}
    />,
  )
}

/** As `renderToStaticMarkup` writes text and attributes. */
const escaped = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

describe('Stop card against the planner’s own legs', () => {
  it('is a plan the shared store accepts', async () => {
    expect(walkPlanProblem(await plannedWalk())).toBeNull()
  })

  it('takes each stop’s leg distance, steepest slope and hazards from the planner, unchanged', async () => {
    const plan = await plannedWalk()
    expect(stopPlanFacts(plan, 0)?.fromPreviousKm).toBeNull()
    expect(stopPlanFacts(plan, 0)?.legSteepestSlopeDeg).toBeNull()
    expect(stopPlanFacts(plan, 0)?.legHazards).toBeNull()
    for (let i = 1; i < STOPS.length; i++) {
      expect(stopPlanFacts(plan, i)?.fromPreviousKm).toBe(plan.legs[i - 1].distanceKm)
      expect(stopPlanFacts(plan, i)?.legSteepestSlopeDeg).toBe(plan.legs[i - 1].steepestSlopeDeg)
      expect(stopPlanFacts(plan, i)?.legHazards).toBe(plan.legs[i - 1].hazards)
    }
  })

  it('shows the planner’s distance from the previous stop with its method', async () => {
    const plan = await plannedWalk()
    for (const i of [1, 2]) {
      const km = plan.legs[i - 1].distanceKm
      if (km.classification !== 'DERIVED') throw new Error(`Leg ${i} has no distance`)
      const html = renderCard(plan, i)
      expect(html).toContain('From the previous stop')
      expect(html).toContain(escaped(formatDistanceM(km.value * 1000)))
      expect(html).toContain(escaped(km.method))
    }
  })

  it('shows a leg the planner could not lay out as unavailable with its reason, never as 0 m', async () => {
    const plan = await plannedWalk()
    const km = plan.legs[2].distanceKm
    if (km.classification !== 'UNAVAILABLE') throw new Error('Two stops at one place should have no leg distance')
    const html = renderCard(plan, 3)
    expect(html).toContain(escaped(km.reason))
    expect(html).not.toMatch(/>0 m</)
  })

  it('flags the planner’s 25° leg on the way in, with its method, as the HUD does (seen as 23.3° on a real plan)', async () => {
    const plan = await plannedWalk()
    const steepest = plan.legs[1].steepestSlopeDeg
    if (steepest.classification !== 'DERIVED') throw new Error('Leg b → c should have a slope')
    expect(steepest.value).toBeGreaterThan(SUITED_SLOPE_LIMIT.deg)
    const html = renderCard(plan, 2)
    expect(html).toContain('On the way here')
    expect(html).toContain(escaped(steepest.method))
    // Only the leg is over the limit: the slope at the stop (3°) is not.
    expect(html.match(/data-over-limit/g)).toHaveLength(1)
    expect(html).toContain(`Over the ${SUITED_SLOPE_LIMIT.deg}° limit`)
    // The planner's slope hazard is the same fact as the flag, so it is not listed again; and it is no radiation note.
    expect(html).not.toContain('Steep slope')
    expect(html).not.toContain('data-radiation-warning')
  })

  it('does not flag the flat leg in', async () => {
    const html = renderCard(await plannedWalk(), 1)
    expect(html).toContain('Steepest slope')
    expect(html).not.toContain('data-over-limit')
  })

  it('says the leg’s mapped obstacles were not checked when the map was not read, with the planner’s reason', async () => {
    const plan = await plannedWalk(unavailable('fixture: map service down'))
    expect(walkPlanProblem(plan)).toBeNull()
    const hazards = plan.legs[0].hazards
    const notChecked = hazards.classification === 'DERIVED' ? hazards.value.find((h) => h.unit === HAZARD_NOT_CHECKED) : undefined
    if (notChecked?.magnitude.classification !== 'UNAVAILABLE') throw new Error('An unread map should put a not-checked hazard on the leg')
    const html = renderCard(plan, 1)
    // The distance still comes from the planner: the map is a separate check.
    const km = plan.legs[0].distanceKm
    if (km.classification !== 'DERIVED') throw new Error('Leg a → b should have a distance')
    expect(html).toContain(escaped(formatDistanceM(km.value * 1000)))
    // As the walk panel's leg detail says it, so the leg never reads as clear; and no radiation note.
    expect(html).toContain('Mapped obstacles not checked')
    expect(html).toContain(escaped(notChecked.magnitude.reason))
    expect(html).not.toContain('data-radiation-warning')
  })

  it('names the first stop as the start, with no distance', async () => {
    const html = renderCard(await plannedWalk(), 0)
    expect(html).toContain('First stop')
    expect(html).not.toContain('From the previous stop')
  })
})
