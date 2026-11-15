import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_MISSION_SETTINGS,
  derived,
  MISSION_SETTING_DEFAULTS,
  SUITED_SLOPE_LIMIT,
  unavailable,
  walkPlanProblem,
  type MarsCoordinate,
  type SampleStop,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { DEFAULT_MISSION_SETTINGS as SLIDER_DEFAULTS, SETTING_SPECS } from '../../src/features/mission-ui/walk/missionSettings'
import { MAX_WALK_PLANS, useWalkPlan } from '../../src/state'

// Test fixtures only: invented walks, never shown in the app.
const at = (lon: number, lat = 18.44): MarsCoordinate => ({ latitude: lat, longitudeEast: lon })
const stop = (id: string, lon: number): WalkStop => ({
  id,
  label: `Fixture ${id}`,
  coordinate: at(lon),
  unit: unavailable('fixture'),
  reason: derived('fixture reason', 'fixture method'),
})
const leg = (from: string, to: string, path: WalkLeg['path'] = unavailable('fixture')): WalkLeg => ({
  fromStopId: from,
  toStopId: to,
  path,
  distanceKm: unavailable('fixture'),
  steepestSlopeDeg: unavailable('fixture'),
  hazards: unavailable('fixture'),
})
const sample = (id: string, order: number, coordinate: MarsCoordinate, dwellMin = 5): SampleStop => ({
  id,
  order,
  coordinate,
  dwellMin,
})
const plan = (overrides: Partial<WalkPlan> = {}): WalkPlan => ({
  goal: { id: 'g', label: 'Fixture goal', unitNames: ['Fixture unit'], reason: derived('fixture', 'fixture') },
  stops: [stop('a', 77.45), stop('b', 77.46), stop('c', 77.47)],
  legs: [leg('a', 'b'), leg('b', 'c')],
  slopeLimit: SUITED_SLOPE_LIMIT,
  ...overrides,
})
const mission = (overrides: Partial<WalkPlan> = {}): WalkPlan =>
  plan({
    kind: 'flat-bedrock',
    settings: DEFAULT_MISSION_SETTINGS,
    samples: [sample('s1', 1, at(77.455)), sample('s2', 2, at(77.465))],
    ...overrides,
  })

describe('mission settings defaults', () => {
  it('cites the slope and calls the rest project choices', () => {
    expect(MISSION_SETTING_DEFAULTS.maxSlopeDeg.value).toBe(SUITED_SLOPE_LIMIT.deg)
    expect(MISSION_SETTING_DEFAULTS.maxSlopeDeg.source).toBe(SUITED_SLOPE_LIMIT.source)
    for (const key of ['samples', 'energyKcal', 'durationMin'] as const) {
      expect(MISSION_SETTING_DEFAULTS[key].basis).toBe('project choice')
      expect(MISSION_SETTING_DEFAULTS[key].source).toBeUndefined()
    }
    expect(DEFAULT_MISSION_SETTINGS).toEqual({ maxSlopeDeg: 20, samples: 6, energyKcal: 600, durationMin: 240 })
  })

  it('is the one defaults table: the sliders read it', () => {
    expect(SLIDER_DEFAULTS).toBe(DEFAULT_MISSION_SETTINGS)
    for (const spec of SETTING_SPECS) {
      expect(spec.default).toBe(MISSION_SETTING_DEFAULTS[spec.key].value)
      expect(spec.basis).toBe(MISSION_SETTING_DEFAULTS[spec.key].basis)
    }
  })
})

describe('walkPlanProblem on the Plan a walk fields', () => {
  it('accepts a goal-based plan without them, and the sample walk still', () => {
    expect(walkPlanProblem(plan())).toBeNull()
    expect(walkPlanProblem(SAMPLE_WALK_PLAN)).toBeNull()
  })

  it('accepts a walk with its kind, settings and samples on the path', () => {
    expect(walkPlanProblem(mission())).toBeNull()
    expect(walkPlanProblem(mission({ kind: 'rim-to-floor' }))).toBeNull()
    expect(walkPlanProblem(mission({ samples: [] }))).toBeNull()
  })

  it('refuses a kind it does not know', () => {
    expect(walkPlanProblem(mission({ kind: 'downhill' as WalkPlan['kind'] }))).toMatch(/not a kind of walk/)
  })

  it('refuses settings that are not settings, or a slope limit that is not theirs', () => {
    const s = DEFAULT_MISSION_SETTINGS
    expect(walkPlanProblem(plan({ settings: { ...s, maxSlopeDeg: 0 } }))).toMatch(/not a slope/)
    expect(walkPlanProblem(plan({ settings: { ...s, samples: 2.5 } }))).toMatch(/not a number of samples/)
    expect(walkPlanProblem(plan({ settings: { ...s, energyKcal: Number.NaN } }))).toMatch(/not an energy budget/)
    expect(walkPlanProblem(plan({ settings: { ...s, durationMin: 0 } }))).toMatch(/not a duration/)
    expect(walkPlanProblem(plan({ settings: { ...s, maxSlopeDeg: 15 } }))).toMatch(/slope limit \(20°\) is not the settings' max slope \(15°\)/)
  })

  it('needs settings to count samples against, and no more samples than they allow', () => {
    expect(walkPlanProblem(plan({ samples: [sample('s1', 1, at(77.455))] }))).toMatch(/need the settings/)
    const one = { ...DEFAULT_MISSION_SETTINGS, samples: 1 }
    expect(walkPlanProblem(mission({ settings: one }))).toMatch(/2 samples are more than the settings' 1/)
  })

  it('refuses samples whose ids, orders or minutes are wrong', () => {
    const p = at(77.455)
    expect(walkPlanProblem(mission({ samples: [sample('', 1, p)] }))).toMatch(/no id/)
    expect(walkPlanProblem(mission({ samples: [sample('s', 1, p), sample('s', 2, p)] }))).toMatch(/share an id/)
    expect(walkPlanProblem(mission({ samples: [sample('s1', 1, p), sample('s2', 1, p)] }))).toMatch(/share order 1/)
    expect(walkPlanProblem(mission({ samples: [sample('s1', 0, p)] }))).toMatch(/order 0 is not one of 1 to 1/)
    expect(walkPlanProblem(mission({ samples: [sample('s1', 3, p), sample('s2', 1, p)] }))).toMatch(/order 3/)
    expect(walkPlanProblem(mission({ samples: [sample('s1', 1, p, -1)] }))).toMatch(/not a time/)
    expect(walkPlanProblem(mission({ samples: [sample('s1', 1, at(400))] }))).toMatch(/longitude-range/)
  })

  it('refuses samples that take longer than the walk may', () => {
    const short = { ...DEFAULT_MISSION_SETTINGS, durationMin: 30 }
    const samples = [sample('s1', 1, at(77.455), 20), sample('s2', 2, at(77.465), 20)]
    expect(walkPlanProblem(mission({ settings: short, samples }))).toMatch(/take 40 min, more than the settings' 30 min/)
  })

  it('lists samples in any order: `order` is the walking order', () => {
    expect(walkPlanProblem(mission({ samples: [sample('s2', 2, at(77.465)), sample('s1', 1, at(77.455))] }))).toBeNull()
  })

  it('refuses a sample off the walk, on the straight line where a leg has no path', () => {
    // 0.001° of latitude is about 59 m off the line between the stops.
    expect(walkPlanProblem(mission({ samples: [sample('s1', 1, at(77.455, 18.441))] }))).toMatch(/not on the walk's path/)
    // Past the last stop, on the line's extension but not on the walk.
    expect(walkPlanProblem(mission({ samples: [sample('s1', 1, at(77.48))] }))).toMatch(/not on the walk's path/)
    // A stop itself is on the walk.
    expect(walkPlanProblem(mission({ samples: [sample('s1', 1, at(77.46))] }))).toBeNull()
  })

  it('follows a leg\'s own path where it has one', () => {
    // Leg a→b detours north through a corner; a sample at the corner is on it, one on the straight line is not.
    const corner = at(77.455, 18.45)
    const detour = leg('a', 'b', derived([at(77.45), corner, at(77.46)], 'fixture routing'))
    const legs = [detour, leg('b', 'c')]
    expect(walkPlanProblem(mission({ legs, samples: [sample('s1', 1, corner)] }))).toBeNull()
    expect(walkPlanProblem(mission({ legs, samples: [sample('s1', 1, at(77.455))] }))).toMatch(/not on the walk's path/)
  })

  it('finds a sample on a path across 0/360°E', () => {
    const stops = [stop('a', 359.995), stop('b', 0.005)]
    expect(walkPlanProblem(mission({ stops, legs: [leg('a', 'b')], samples: [sample('s1', 1, at(0))] }))).toBeNull()
  })
})

describe('useWalkPlan with three walks', () => {
  beforeEach(() => useWalkPlan.getState().clearWalkPlan())
  const three = () => [
    mission({ kind: 'flat-bedrock' }),
    mission({ kind: 'rim-to-floor' }),
    mission({ kind: 'rover-check', stops: [stop('x', 77.5), stop('y', 77.51)], legs: [leg('x', 'y')], samples: [] }),
  ]

  it('holds up to three plans, the first selected, and `plan` is the selected one', () => {
    const plans = three()
    expect(useWalkPlan.getState().setWalkPlans(plans)).toBeNull()
    const s = useWalkPlan.getState()
    expect(s.plans).toHaveLength(MAX_WALK_PLANS)
    expect(s.selectedIndex).toBe(0)
    expect(s.plan).toBe(plans[0])
    expect(s.activeStopIndex).toBe(0)
  })

  it('selects a walk, clamped, and starts it at its first stop', () => {
    const plans = three()
    useWalkPlan.getState().setWalkPlans(plans)
    useWalkPlan.getState().nextStop()
    useWalkPlan.getState().selectWalk(2)
    expect(useWalkPlan.getState().plan).toBe(plans[2])
    expect(useWalkPlan.getState().activeStopIndex).toBe(0)
    useWalkPlan.getState().nextStop()
    expect(useWalkPlan.getState().activeStopIndex).toBe(1)
    useWalkPlan.getState().selectWalk(9)
    expect(useWalkPlan.getState().selectedIndex).toBe(2)
    expect(useWalkPlan.getState().activeStopIndex).toBe(1)
    useWalkPlan.getState().selectWalk(-1)
    expect(useWalkPlan.getState().plan).toBe(plans[0])
  })

  it('refuses the lot, naming the walk, when one is broken or there are too many', () => {
    const plans = three()
    useWalkPlan.getState().setWalkPlans(plans)
    const broken = [plans[0], mission({ kind: 'downhill' as WalkPlan['kind'] })]
    expect(useWalkPlan.getState().setWalkPlans(broken)).toMatch(/^Walk 2: .*not a kind of walk/)
    expect(useWalkPlan.getState().setWalkPlans([...plans, plans[0]])).toMatch(/1 to 3 walks, not 4/)
    expect(useWalkPlan.getState().setWalkPlans([])).toMatch(/not 0/)
    expect(useWalkPlan.getState().plans).toHaveLength(3)
  })

  it('keeps one plan working as before, and clears every walk', () => {
    expect(useWalkPlan.getState().setWalkPlan(plan())).toBeNull()
    expect(useWalkPlan.getState().plans).toHaveLength(1)
    useWalkPlan.getState().selectWalk(1)
    expect(useWalkPlan.getState().selectedIndex).toBe(0)
    useWalkPlan.getState().clearWalkPlan()
    expect(useWalkPlan.getState()).toMatchObject({ plans: [], plan: null, selectedIndex: 0, activeStopIndex: 0 })
    useWalkPlan.getState().selectWalk(1)
    expect(useWalkPlan.getState().plan).toBeNull()
  })
})
