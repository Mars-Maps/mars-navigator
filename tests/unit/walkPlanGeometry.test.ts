import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { DEFAULT_MISSION_SETTINGS, derived, unavailable, type WalkPlan } from '../../src/domain'
import { coordinateToLocalPoint } from '../../src/features/mars-3d/projection'
import {
  GOAL_WALK_COLOUR,
  SAMPLE_GREEN,
  samplePointNames,
  WALK_KIND_COLOUR,
  walkColour,
  walkPlanGeometry,
} from '../../src/features/mars-3d/walkPlanGeometry'

const RADIUS = 100
const at = (array: Float32Array, i: number) => new Vector3().fromArray(array, i * 3)
const point = (c: { latitude: number; longitudeEast: number }) => coordinateToLocalPoint(c, RADIUS)

/** The sample's stops, with each leg's path set by `path`. */
const planWith = (path: (i: number, from: WalkPlan['stops'][number], to: WalkPlan['stops'][number]) => WalkPlan['legs'][number]['path']): WalkPlan => ({
  ...SAMPLE_WALK_PLAN,
  legs: SAMPLE_WALK_PLAN.legs.map((leg, i) => ({
    ...leg,
    path: path(i, SAMPLE_WALK_PLAN.stops[i], SAMPLE_WALK_PLAN.stops[i + 1]),
  })),
})
const straight = (from: WalkPlan['stops'][number], to: WalkPlan['stops'][number]) =>
  derived([from.coordinate, to.coordinate], 'straight line, test')

describe('walkPlanGeometry', () => {
  it('draws nothing with no plan', () => {
    const g = walkPlanGeometry(null, RADIUS)
    expect(g.segments.length).toBe(0)
    expect(g.lineDistances.length).toBe(0)
    expect(g.stops.length).toBe(0)
  })

  it('puts one dot on each stop, in walking order', () => {
    const { stops } = walkPlanGeometry(SAMPLE_WALK_PLAN, RADIUS)
    expect(stops.length).toBe(SAMPLE_WALK_PLAN.stops.length * 3)
    SAMPLE_WALK_PLAN.stops.forEach((stop, i) => {
      expect(at(stops, i).distanceTo(point(stop.coordinate))).toBeLessThan(1e-4)
    })
  })

  it("draws each leg's own path, every vertex of it, in order", () => {
    const stops = SAMPLE_WALK_PLAN.stops
    const bend = { latitude: stops[0].coordinate.latitude + 0.5, longitudeEast: stops[0].coordinate.longitudeEast }
    const plan = planWith((i, from, to) =>
      i === 0 ? derived([from.coordinate, bend, to.coordinate], 'bent, test') : straight(from, to),
    )
    const { segments } = walkPlanGeometry(plan, RADIUS)
    // Two segments for the bent leg, one each for the rest, two vertices each.
    expect(segments.length / 3).toBe((plan.legs.length + 1) * 2)
    expect(at(segments, 0).distanceTo(point(stops[0].coordinate))).toBeLessThan(1e-4)
    expect(at(segments, 1).distanceTo(point(bend))).toBeLessThan(1e-4)
    expect(at(segments, 2).distanceTo(point(bend))).toBeLessThan(1e-4)
    expect(at(segments, 3).distanceTo(point(stops[1].coordinate))).toBeLessThan(1e-4)
  })

  it('never joins the stops of a leg with no path, and keeps its stops', () => {
    const plan = planWith((i, from, to) => (i === 0 ? unavailable('no path, test') : straight(from, to)))
    const { segments, stops } = walkPlanGeometry(plan, RADIUS)
    expect(segments.length / 3).toBe((plan.legs.length - 1) * 2)
    expect(stops.length).toBe(plan.stops.length * 3)
    expect(at(segments, 0).distanceTo(point(plan.stops[1].coordinate))).toBeLessThan(1e-4)
  })

  it('draws no line for a path of one point', () => {
    const plan = planWith((_, from) => derived([from.coordinate], 'one point, test'))
    const { segments, lineDistances } = walkPlanGeometry(plan, RADIUS)
    expect(segments.length).toBe(0)
    expect(lineDistances.length).toBe(0)
  })

  it('runs the dash distance on along the walk, one value per vertex', () => {
    const plan = planWith((_, from, to) => straight(from, to))
    const { segments, lineDistances } = walkPlanGeometry(plan, RADIUS)
    expect(lineDistances.length).toBe(segments.length / 3)
    expect(lineDistances[0]).toBe(0)
    for (let i = 0; i + 1 < lineDistances.length; i += 2) {
      expect(lineDistances[i + 1] - lineDistances[i]).toBeCloseTo(at(segments, i).distanceTo(at(segments, i + 1)), 3)
      if (i > 0) expect(lineDistances[i]).toBe(lineDistances[i - 1])
    }
  })
})

describe('walkPlanGeometry: samples and colours', () => {
  const withSamples = (samples: WalkPlan['samples']): WalkPlan => ({
    ...SAMPLE_WALK_PLAN,
    settings: DEFAULT_MISSION_SETTINGS,
    samples,
  })
  const stop1 = SAMPLE_WALK_PLAN.stops[1]
  const between = { latitude: 18.44, longitudeEast: 77.45 }

  it('draws no sample point for a plan without samples, or no plan', () => {
    expect(walkPlanGeometry(SAMPLE_WALK_PLAN, RADIUS).samples.length).toBe(0)
    expect(walkPlanGeometry(null, RADIUS).samples.length).toBe(0)
    expect(samplePointNames(null)).toEqual([])
  })

  it('puts one point per sample at its own coordinate, in walking order', () => {
    const plan = withSamples([
      { id: 'b', order: 2, coordinate: stop1.coordinate, dwellMin: 5 },
      { id: 'a', order: 1, coordinate: between, dwellMin: 5 },
    ])
    const { samples } = walkPlanGeometry(plan, RADIUS)
    expect(samples.length).toBe(6)
    expect(at(samples, 0).distanceTo(point(between))).toBeCloseTo(0, 5)
    expect(at(samples, 1).distanceTo(point(stop1.coordinate))).toBeCloseTo(0, 5)
  })

  it('names each sample: number, minutes, the unit where it is at a stop, place', () => {
    const plan = withSamples([
      { id: 'a', order: 1, coordinate: between, dwellMin: 5 },
      { id: 'b', order: 2, coordinate: stop1.coordinate, dwellMin: 5 },
    ])
    const [first, second] = samplePointNames(plan)
    expect(first).toMatch(/^Sample 1 of 2 · 5 min · 18\.4°N/)
    const unit = stop1.unit.classification !== 'UNAVAILABLE' ? stop1.unit.value.name : null
    if (unit) expect(second).toContain(`· ${unit} ·`)
    expect(second).toMatch(/^Sample 2 of 2 · 5 min/)
  })

  it('gives each walk kind its own colour, clear of hazard red and sample green; a goal walk stays white', () => {
    const colours = Object.values(WALK_KIND_COLOUR)
    expect(new Set(colours).size).toBe(3)
    for (const c of colours) {
      expect(c).not.toBe(SAMPLE_GREEN)
      expect(c).not.toBe(0xe5352b) // RouteHazardPoints' red
    }
    expect(walkColour(SAMPLE_WALK_PLAN)).toBe(GOAL_WALK_COLOUR)
    expect(walkColour({ ...SAMPLE_WALK_PLAN, kind: 'rover-check' })).toBe(WALK_KIND_COLOUR['rover-check'])
  })
})
