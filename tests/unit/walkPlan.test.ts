import { beforeEach, describe, expect, it } from 'vitest'
import {
  derived,
  SUITED_SLOPE_LIMIT,
  unavailable,
  walkPlanProblem,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import { clampStopIndex, useWalkPlan } from '../../src/state'

// Test fixtures only: an invented walk, never shown in the app.
const stop = (id: string, lon: number): WalkStop => ({
  id,
  label: `Fixture ${id}`,
  coordinate: { latitude: 18.44, longitudeEast: lon },
  unit: unavailable('fixture'),
  reason: derived('fixture reason', 'fixture method'),
})
const leg = (from: string, to: string): WalkLeg => ({
  fromStopId: from,
  toStopId: to,
  path: unavailable('fixture'),
  distanceKm: unavailable('fixture'),
  steepestSlopeDeg: unavailable('fixture'),
  hazards: unavailable('fixture'),
})
const plan = (overrides: Partial<WalkPlan> = {}): WalkPlan => ({
  goal: { id: 'g', label: 'Fixture goal', unitNames: ['Fixture unit'], reason: derived('fixture', 'fixture') },
  stops: [stop('a', 77.45), stop('b', 77.46), stop('c', 77.47)],
  legs: [leg('a', 'b'), leg('b', 'c')],
  slopeLimit: SUITED_SLOPE_LIMIT,
  ...overrides,
})

describe('walkPlanProblem', () => {
  it('accepts a plan whose legs join its stops in order', () => {
    expect(walkPlanProblem(plan())).toBeNull()
  })

  it('names what is wrong with a broken plan', () => {
    expect(walkPlanProblem(plan({ stops: [stop('a', 77.45)], legs: [] }))).toMatch(/at least two stops/)
    expect(walkPlanProblem(plan({ stops: [stop('a', 77.45), stop('a', 77.46)], legs: [leg('a', 'a')] }))).toMatch(/share an id/)
    expect(walkPlanProblem(plan({ legs: [leg('a', 'b')] }))).toMatch(/3 stops need 2 legs, not 1/)
    expect(walkPlanProblem(plan({ legs: [leg('a', 'b'), leg('a', 'c')] }))).toMatch(/Leg 2 must go from b to c/)
    expect(walkPlanProblem(plan({ slopeLimit: { ...SUITED_SLOPE_LIMIT, deg: 0 } }))).toMatch(/not a slope/)
    expect(walkPlanProblem(plan({ stops: [stop('a', 77.45), stop('b', 400), stop('c', 77.47)] }))).toMatch(
      /Stop b is not at a valid coordinate \(longitude-range\)/,
    )
    const nowhere = { ...stop('b', 77.46), coordinate: { latitude: Number.NaN, longitudeEast: 77.46 } }
    expect(walkPlanProblem(plan({ stops: [stop('a', 77.45), nowhere, stop('c', 77.47)] }))).toMatch(/\(format\)/)
    expect(walkPlanProblem(plan({ stops: [stop('', 77.45), stop('b', 77.46), stop('c', 77.47)], legs: [leg('', 'b'), leg('b', 'c')] }))).toMatch(/A stop has no id/)
    const goal = plan().goal
    expect(walkPlanProblem(plan({ goal: { ...goal, unitNames: [] } }))).toMatch(/names no geologic unit/)
    expect(walkPlanProblem(plan({ goal: { ...goal, id: '' } }))).toMatch(/goal has no id/)
  })

  it('carries the cited suited-walking limit', () => {
    expect(SUITED_SLOPE_LIMIT.deg).toBe(20)
    expect(SUITED_SLOPE_LIMIT.label).toMatch(/not a Mars requirement/)
    expect(SUITED_SLOPE_LIMIT.source).toMatch(/EVA-EXP-0075/)
  })
})

describe('useWalkPlan', () => {
  beforeEach(() => useWalkPlan.getState().clearWalkPlan())

  it('starts empty, and sets a plan at its first stop', () => {
    expect(useWalkPlan.getState().plan).toBeNull()
    expect(useWalkPlan.getState().setWalkPlan(plan())).toBeNull()
    expect(useWalkPlan.getState().plan?.stops).toHaveLength(3)
    expect(useWalkPlan.getState().activeStopIndex).toBe(0)
  })

  it('refuses a broken plan and keeps the one it has', () => {
    useWalkPlan.getState().setWalkPlan(plan())
    useWalkPlan.getState().nextStop()
    const before = useWalkPlan.getState().plan
    expect(useWalkPlan.getState().setWalkPlan(plan({ legs: [] }))).toMatch(/need 2 legs/)
    expect(useWalkPlan.getState().plan).toBe(before)
    expect(useWalkPlan.getState().activeStopIndex).toBe(1)
  })

  it('steps through the stops and stops at the ends', () => {
    const s = useWalkPlan.getState
    s().setWalkPlan(plan())
    s().nextStop()
    s().nextStop()
    s().nextStop()
    expect(s().activeStopIndex).toBe(2)
    s().previousStop()
    expect(s().activeStopIndex).toBe(1)
    s().goToStop(-5)
    expect(s().activeStopIndex).toBe(0)
  })

  it('does nothing to step with no plan, and a new plan starts again at the first stop', () => {
    const s = useWalkPlan.getState
    s().nextStop()
    expect(s().activeStopIndex).toBe(0)
    s().setWalkPlan(plan())
    s().goToStop(2)
    s().setWalkPlan(plan())
    expect(s().activeStopIndex).toBe(0)
  })

  it('clamps any index into the stops', () => {
    expect(clampStopIndex(7, 3)).toBe(2)
    expect(clampStopIndex(-1, 3)).toBe(0)
    expect(clampStopIndex(1.9, 3)).toBe(1)
    expect(clampStopIndex(Number.NaN, 3)).toBe(0)
    expect(clampStopIndex(4, 0)).toBe(0)
  })
})
