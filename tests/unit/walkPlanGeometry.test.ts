import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { derived, unavailable, type WalkPlan } from '../../src/domain'
import { coordinateToLocalPoint } from '../../src/features/mars-3d/projection'
import { walkPlanGeometry } from '../../src/features/mars-3d/walkPlanGeometry'

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
