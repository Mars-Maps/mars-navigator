import { describe, expect, it } from 'vitest'
import {
  boxAround,
  createWalkPlanner,
  planStatusAt,
  planWalk,
  standAtWalkStart,
  walkHeights,
  type WalkPlanner,
  type WalkPlannerSources,
} from '../../src/app/walkPlanner'
import type { SourcedHeights } from '../../src/data/adapters/LayeredElevation'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import {
  isAvailable,
  MARS_MEAN_RADIUS_KM,
  official,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type GeologicMap,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type RoverTraverse,
  type SiteBounds,
} from '../../src/domain'
import { SCIENCE_GOALS } from '../../src/features/route-analysis/scienceGoals'
import { walkStart } from '../../src/features/mission-ui/walk/walkStart'
import { useMissionStore, useWalkPlan } from '../../src/state'

// Test fixtures only: an invented map, polygons and flat heights near Jezero.
const JEZERO: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const MAP: GeologicMap = { id: 'SIM 3464', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }
const SITE = { name: 'Fixture crater', map: MAP, bounds: { west: 77, east: 78, south: 18, north: 19 } }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(JEZERO.latitude * RAD)
const at = (x: number, y: number): MarsCoordinate => ({
  latitude: JEZERO.latitude + y / KM_PER_DEG_LAT,
  longitudeEast: JEZERO.longitudeEast + x / KM_PER_DEG_LON,
})
const GOAL = SCIENCE_GOALS[0]
const unit = (name: string, interpretation?: string): GeologicUnit => ({
  symbol: 'fx',
  name,
  map: MAP,
  ...(interpretation ? { interpretation } : {}),
})
/** A 400 m square of `name`, its near edge `x` km east of the start. */
const square = (name: string, x: number): GeologicUnitArea => ({
  unit: unit(name),
  rings: [[at(x, -0.2), at(x + 0.4, -0.2), at(x + 0.4, 0.2), at(x, 0.2), at(x, -0.2)]],
})
const ON_GOAL = GOAL.unitNames[0]
/** A rover that drove along the start's latitude, from 3 km west of it to the start. */
const ROVER: RoverTraverse = {
  rover: 'perseverance',
  source: 'fixture feed',
  retrievedUtcMs: 0,
  points: [at(-3, 0), JEZERO].map((coordinate, i) => ({
    coordinate,
    sol: i,
    rmc: { site: 1, drive: i },
    elevationMeters: unavailable('fixture'),
    tiltDegrees: unavailable('fixture'),
  })),
}
const signal = () => new AbortController().signal

/** Sources answering from fixtures; each test overrides what it is about. */
function sources(over: Partial<WalkPlannerSources> = {}): WalkPlannerSources {
  return {
    site: SITE,
    units: async () => official([square(ON_GOAL, 1)], 'Fixture citation'),
    unitAt: async () => official(unit(ON_GOAL, 'Fixture interpretation.'), 'Fixture citation'),
    features: async () => official<GeologicFeatures>({ points: [], lines: [], areas: [] }, 'Fixture citation'),
    heights: async (points) => {
      const n = points.length / 2
      const read = { heights: new Float32Array(n).fill(-2500), model: new Uint8Array(n), models: [{ cellKm: 0.02, label: 'fixture CTX', source: 'fixture CTX', site: true }] }
      return official(read, 'fixture chain')
    },
    cellKmAlong: () => 0.02,
    traverse: async () => official(ROVER, 'Fixture feed'),
    ...over,
  }
}
const plan = (over: Partial<WalkPlannerSources> = {}, start = JEZERO) =>
  planWalk(createWalkPlanner(sources(over)), GOAL, start, signal())

describe('the walk planner', () => {
  it('offers the reviewed science goals', () => {
    expect(createWalkPlanner(sources()).goals).toBe(SCIENCE_GOALS)
  })

  it('plans stops on the goal’s units, with legs measured and scanned, never invented', async () => {
    const r = await plan()
    if (r.status !== 'planned') throw new Error(`expected a plan: ${JSON.stringify(r)}`)
    expect(r.plan.stops).toHaveLength(2)
    expect(r.plan.stops[0].coordinate).toEqual(JEZERO)
    expect(r.plan.stops[1].label).toContain(ON_GOAL)
    const [leg] = r.plan.legs
    expect(leg.distanceKm.classification).toBe('DERIVED')
    expect(leg.steepestSlopeDeg).toMatchObject({ classification: 'DERIVED', value: 0 })
    expect(leg.hazards).toMatchObject({ classification: 'DERIVED', value: [] })
    const marks = [r.plan.goal.reason, ...r.plan.stops.flatMap((s) => [s.unit, s.reason]), leg.path, leg.distanceKm].map((c) => c.classification)
    expect(marks).not.toContain('SIMULATED')
  })

  it('gives each leg its farthest distance from the rover path', async () => {
    const r = await plan()
    if (r.status !== 'planned') throw new Error(`expected a plan: ${JSON.stringify(r)}`)
    const distance = r.plan.legs[0].farthestFromRoverPathM
    if (distance?.classification !== 'DERIVED') throw new Error(`expected a distance: ${JSON.stringify(distance)}`)
    // The stop stands 50 m inside the square's near edge, 1.05 km east of the rover's last waypoint.
    expect(distance.value).toBeGreaterThanOrEqual(1050)
    expect(distance.value).toBeLessThan(1100)
  })

  it('still plans when the rover path cannot be read, each leg saying why it has no distance', async () => {
    const r = await plan({ traverse: async () => unavailable('fixture: the feed answered 503') })
    if (r.status !== 'planned') throw new Error(`expected a plan: ${JSON.stringify(r)}`)
    const distance = r.plan.legs[0].farthestFromRoverPathM
    expect(distance?.classification).toBe('UNAVAILABLE')
    expect(JSON.stringify(distance)).toContain('fixture: the feed answered 503')
  })

  it('still plans when the rover path source throws, each leg giving the error', async () => {
    const r = await plan({
      traverse: async () => {
        throw new Error('fixture: the source threw')
      },
    })
    if (r.status !== 'planned') throw new Error(`expected a plan: ${JSON.stringify(r)}`)
    const distance = r.plan.legs[0].farthestFromRoverPathM
    expect(distance?.classification).toBe('UNAVAILABLE')
    expect(JSON.stringify(distance)).toContain('fixture: the source threw')
  })

  it('reads the units within the walking range of the start, and the features around the stops', async () => {
    const boxes: Record<string, SiteBounds> = {}
    const r = await plan({
      units: async (b) => {
        boxes.units = b
        return official([square(ON_GOAL, 1)], 'Fixture citation')
      },
      features: async (b) => {
        boxes.features = b
        return official<GeologicFeatures>({ points: [], lines: [], areas: [] }, 'Fixture citation')
      },
    })
    expect(r.status).toBe('planned')
    expect(boxes.units.north - JEZERO.latitude).toBeCloseTo(5 / KM_PER_DEG_LAT, 6)
    // The crater distance is checked outside the leg, so the box goes wider than the stops.
    expect(boxes.features.west).toBeLessThan(JEZERO.longitudeEast - 0.1 / KM_PER_DEG_LON)
    expect(boxes.features.east).toBeGreaterThan(at(1, 0).longitudeEast + 0.1 / KM_PER_DEG_LON)
    expect(boxes.features.north).toBeGreaterThan(JEZERO.latitude + 0.1 / KM_PER_DEG_LAT)
  })

  it('gives each stop the map’s own words, read at that stop', async () => {
    const r = await plan()
    if (r.status !== 'planned') throw new Error('expected a plan')
    const reason = r.plan.stops[1].reason
    expect(reason.classification === 'DERIVED' && reason.value).toContain('"Fixture interpretation."')
  })

  it('names the unit under the start from its own read: a contact is UNAVAILABLE, not the first polygon', async () => {
    const contact = 'On a contact between fixture units'
    const r = await plan({
      unitAt: async (point) =>
        point === JEZERO ? unavailable(contact) : official(unit(ON_GOAL), 'Fixture citation'),
    })
    if (r.status !== 'planned') throw new Error('expected a plan')
    expect(r.plan.stops[0].unit).toEqual(unavailable(contact))
  })

  it('drops a stop the map’s read puts on another unit, renumbering the rest', async () => {
    const units = official([square(ON_GOAL, 1), square(ON_GOAL, 2)], 'Fixture citation')
    let reads = 0
    const r = await plan({
      units: async () => units,
      // The start, then the nearer stop on another unit, then the further on the goal's.
      unitAt: async () => official(unit(++reads === 2 ? 'Some other unit' : ON_GOAL), 'Fixture citation'),
    })
    if (r.status !== 'planned') throw new Error(`expected a plan: ${JSON.stringify(r)}`)
    expect(r.plan.stops.map((s) => s.id)).toEqual([`${GOAL.id}-1`, `${GOAL.id}-2`])
    // The further stop was the second after the start; renumbered, it is the first (Start, Stop 1).
    expect(r.plan.stops[1].label).toBe(`Stop 1 · ${ON_GOAL}`)
    expect(r.plan.stops[1].coordinate.longitudeEast).toBeGreaterThan(at(1.9, 0).longitudeEast)
  })

  it('says so when every stop turns out to be on other ground', async () => {
    let reads = 0
    const r = await plan({ unitAt: async () => official(unit(++reads === 1 ? ON_GOAL : 'Some other unit'), 'Fixture citation') })
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('no other ground of the goal') })
  })

  it.each([
    ['a failed read', 'fixture: the service is down'],
    ['a contact', 'On a contact between fixture units'],
    ['no map there', 'No geologic map covers this point'],
  ])('keeps a stop whose read gave no unit, UNAVAILABLE and saying so, never OFFICIAL from a polygon: %s', async (_case, why) => {
    const r = await plan({ unitAt: async () => unavailable(why) })
    if (r.status !== 'planned') throw new Error('expected a plan')
    expect(r.plan.stops[0].unit).toEqual(unavailable(why))
    const stop = r.plan.stops[1]
    expect(stop.unit).toEqual(unavailable(why))
    expect(stop.label).toBe('Stop 1')
    expect(stop.reason.classification === 'DERIVED' && stop.reason.value).toContain('was not confirmed')
    expect(stop.reason.classification === 'DERIVED' && stop.reason.value).toContain(ON_GOAL)
    expect(stop.reason.classification === 'DERIVED' && stop.reason.method).toContain('SIM 3464')
  })

  it('refuses a start off the map sheet, before reading anything', async () => {
    let reads = 0
    const r = await plan(
      {
        units: async () => {
          reads++
          return official([], 'Fixture citation')
        },
      },
      { latitude: -4.6, longitudeEast: 137.4 },
    )
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining('outside the SIM 3464 map sheet') })
    expect(reads).toBe(0)
  })

  it('says why when the map’s units cannot be read, and returns no plan', async () => {
    expect(await plan({ units: async () => unavailable('fixture: the service is down') })).toEqual({
      status: 'failed',
      reason: expect.stringContaining('fixture: the service is down'),
    })
  })

  it('says so when the goal has no ground in range, rather than a walk of one stop', async () => {
    const r = await plan({ units: async () => official([square('Some other unit', 1)], 'Fixture citation') })
    expect(r).toEqual({ status: 'failed', reason: expect.stringContaining(`no other ground of the goal "${GOAL.label}"`) })
  })

  it('still plans when the features cannot be read, each leg saying they were not checked', async () => {
    const r = await plan({ features: async () => unavailable('fixture: no features') })
    if (r.status !== 'planned') throw new Error('expected a plan')
    const hazards = isAvailable(r.plan.legs[0].hazards) ? r.plan.legs[0].hazards.value : []
    expect(hazards.map((h) => h.unit)).toEqual(['not checked'])
  })

  it('still plans when the heights cannot be read, the slope unknown rather than flat', async () => {
    const r = await plan({ heights: async () => unavailable('fixture: no heights') })
    if (r.status !== 'planned') throw new Error('expected a plan')
    expect(r.plan.legs[0].steepestSlopeDeg.classification).toBe('UNAVAILABLE')
  })
})

describe('planWalk', () => {
  const working = createWalkPlanner(sources())

  it('says why when the planner throws, and returns no half plan', async () => {
    const broken: WalkPlanner = {
      ...working,
      walkLegs: async () => {
        throw new Error('fixture failure')
      },
    }
    expect(await planWalk(broken, GOAL, JEZERO, signal())).toEqual({
      status: 'failed',
      reason: 'The planner failed: fixture failure',
    })
  })

  it('refuses a plan that breaks the contract, with the contract’s reason', async () => {
    const noLegs: WalkPlanner = { ...working, walkLegs: async () => [] }
    expect(await planWalk(noLegs, GOAL, JEZERO, signal())).toEqual({ status: 'failed', reason: '2 stops need 1 legs, not 0' })
  })

  it('comes back aborted once cancelled, whatever the planner did', async () => {
    const c = new AbortController()
    c.abort()
    expect(await planWalk(working, GOAL, JEZERO, c.signal)).toEqual({ status: 'aborted' })
  })

  it('comes back aborted when cancelled during the legs, with no plan', async () => {
    const c = new AbortController()
    const midLegs = createWalkPlanner(
      sources({
        features: async () => {
          c.abort()
          return unavailable('Cancelled')
        },
      }),
    )
    expect(await planWalk(midLegs, GOAL, JEZERO, c.signal)).toEqual({ status: 'aborted' })
  })

  it('reads a source’s "Cancelled" as aborted, not as a reason it could not plan', async () => {
    const c = new AbortController()
    const cancelled: WalkPlanner = {
      ...working,
      candidateStops: async () => {
        c.abort()
        return unavailable('Cancelled')
      },
    }
    expect(await planWalk(cancelled, GOAL, JEZERO, c.signal)).toEqual({ status: 'aborted' })
  })
})

describe('planStatusAt', () => {
  const A: MarsCoordinate = { latitude: 1, longitudeEast: 2 }
  const B: MarsCoordinate = { latitude: 3, longitudeEast: 4 }
  it('shows planning and a failure only for the start they were for', () => {
    const planning = { status: { kind: 'planning' as const }, at: A }
    const failed = { status: { kind: 'failed' as const, reason: 'fixture' }, at: A }
    expect(planStatusAt(planning, A)).toEqual({ kind: 'planning' })
    expect(planStatusAt(failed, A)).toEqual({ kind: 'failed', reason: 'fixture' })
    expect(planStatusAt(planning, B)).toEqual({ kind: 'idle' })
    expect(planStatusAt(failed, null)).toEqual({ kind: 'idle' })
    expect(planStatusAt({ status: { kind: 'idle' }, at: null }, A)).toEqual({ kind: 'idle' })
  })
})

describe('boxAround', () => {
  it('goes `km` wider than the points on every side, wider in degrees of longitude away from the equator', () => {
    const b = boxAround([JEZERO, at(1, 1)], 1)
    expect(b.south).toBeCloseTo(JEZERO.latitude - 1 / KM_PER_DEG_LAT, 6)
    expect(b.north).toBeCloseTo(at(1, 2).latitude, 6)
    expect(b.west).toBeLessThan(at(-1, 0).longitudeEast + 1e-6)
    expect(b.east).toBeGreaterThan(at(2, 0).longitudeEast - 1e-6)
  })

  it('stays finite at a pole', () => {
    const b = boxAround([{ latitude: 90, longitudeEast: 10 }], 5)
    expect([b.west, b.east, b.south, b.north].every(Number.isFinite)).toBe(true)
  })
})

describe('walkHeights', () => {
  it('gives each height with the model that answered, and passes an unavailable read on as it is', async () => {
    const value: SourcedHeights = {
      heights: new Float32Array([1, 2]),
      sourceIndex: new Uint8Array([0, 1]),
      sources: [
        { cellKm: 0.001, label: 'fixture HiRISE', source: 'fixture HiRISE', site: true },
        { cellKm: 0.02, label: 'fixture CTX', source: 'fixture CTX', site: true },
      ],
    }
    const read: Classified<SourcedHeights> = official(value, 'fixture chain')
    expect(await walkHeights(async () => read)(new Float64Array(4), signal())).toEqual(
      official({ heights: value.heights, model: value.sourceIndex, models: value.sources }, 'fixture chain'),
    )
    expect(await walkHeights(async () => unavailable('fixture: no model'))(new Float64Array(4), signal())).toEqual(
      unavailable('fixture: no model'),
    )
  })
})

describe('walkStart', () => {
  const A: MarsCoordinate = { latitude: 1, longitudeEast: 2 }
  const B: MarsCoordinate = { latitude: 3, longitudeEast: 4 }
  it('takes the departure first, then the selected point, else none', () => {
    expect(walkStart(A, B)).toEqual({ coordinate: A, from: 'departure' })
    expect(walkStart(null, B)).toEqual({ coordinate: B, from: 'selected point' })
    expect(walkStart(null, null)).toBeNull()
  })
})

describe('standAtWalkStart', () => {
  const mission = () => useMissionStore.getState()
  const walk = () => useWalkPlan.getState()
  const reset = (mode: 'close-up' | 'navigation') => {
    mission().leaveSurface()
    useMissionStore.setState({ viewMode: mode, surfaceSpot: null })
    walk().clearWalkPlan()
  }

  it('stands on the first stop, heading for it, whichever stop was active', () => {
    reset('close-up')
    expect(walk().setWalkPlan(SAMPLE_WALK_PLAN)).toBeNull()
    walk().goToStop(2)
    standAtWalkStart()
    expect(mission().viewMode).toBe('surface')
    expect(mission().surfaceSpot).toEqual(SAMPLE_WALK_PLAN.stops[0].coordinate)
    expect(walk().activeStopIndex).toBe(0)
  })

  it('does nothing without a plan', () => {
    reset('close-up')
    standAtWalkStart()
    expect(mission().viewMode).toBe('close-up')
    expect(mission().surfaceSpot).toBeNull()
  })

  it('stands from navigation too, and leaving goes back there', () => {
    reset('navigation')
    expect(walk().setWalkPlan(SAMPLE_WALK_PLAN)).toBeNull()
    walk().goToStop(1)
    standAtWalkStart()
    expect(mission().viewMode).toBe('surface')
    expect(mission().surfaceReturn).toBe('navigation')
    expect(walk().activeStopIndex).toBe(0)
    reset('close-up')
  })
})
