import { describe, expect, it } from 'vitest'
import {
  derived,
  SUITED_SLOPE_LIMIT,
  unavailable,
  type MarsCoordinate,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import { applyWalkPose, cumulativeM, distanceM, pointAlong, stopsPath, walkFrom } from '../../src/features/mars-3d/surfaceView/walkAlong'
import { makeFrame } from '../../src/features/mars-3d/surfaceView/surfacePatch'

// Test fixtures only: an invented walk, never shown in the app.
const at = (lon: number, lat = 18.44): MarsCoordinate => ({ latitude: lat, longitudeEast: lon })
const stop = (id: string, lon: number): WalkStop => ({
  id,
  label: `Fixture ${id}`,
  coordinate: at(lon),
  unit: unavailable('fixture'),
  reason: derived('fixture reason', 'fixture method'),
})
const leg = (from: string, to: string, path: MarsCoordinate[] | null): WalkLeg => ({
  fromStopId: from,
  toStopId: to,
  path: path ? derived(path, 'fixture method') : unavailable('fixture'),
  distanceKm: unavailable('fixture'),
  steepestSlopeDeg: unavailable('fixture'),
  hazards: unavailable('fixture'),
})
const plan = (legs: WalkLeg[]): WalkPlan => ({
  goal: { id: 'g', label: 'Fixture goal', unitNames: ['Fixture unit'], reason: derived('fixture', 'fixture') },
  stops: [stop('a', 77.45), stop('b', 77.46), stop('c', 77.47)],
  legs,
  slopeLimit: SUITED_SLOPE_LIMIT,
})
const AB = [at(77.45), at(77.455, 18.441), at(77.46)]
const BC = [at(77.46), at(77.465, 18.439), at(77.47)]

describe('walkAlong: stopsPath', () => {
  const full = plan([leg('a', 'b', AB), leg('b', 'c', BC)])

  it('follows the legs forwards, keeping each shared stop once', () => {
    expect(stopsPath(full, 0, 2)).toEqual([...AB, ...BC.slice(1)])
    expect(stopsPath(full, 1, 2)).toEqual(BC)
  })

  it('follows the legs backwards when stepping back', () => {
    expect(stopsPath(full, 2, 1)).toEqual([...BC].reverse())
    expect(stopsPath(full, 2, 0)).toEqual([...[...BC].reverse(), ...[...AB].reverse().slice(1)])
  })

  it('is the stop alone when not moving', () => {
    expect(stopsPath(full, 1, 1)).toEqual([at(77.46)])
  })

  it('is null when a leg on the way has no path, never an invented line', () => {
    const gap = plan([leg('a', 'b', AB), leg('b', 'c', null)])
    expect(stopsPath(gap, 0, 2)).toBeNull()
    expect(stopsPath(gap, 0, 1)).toEqual(AB)
  })
})

describe('walkAlong: distance and position', () => {
  it('measures about 59.2 m per 0.001° of latitude on the mean sphere', () => {
    expect(distanceM(at(77.45, 18.44), at(77.45, 18.441))).toBeCloseTo(59.16, 1)
  })

  it('walks the path: start, part way, end, clamped beyond', () => {
    const path = [at(77.45, 18.44), at(77.45, 18.441), at(77.45, 18.443)]
    const cum = cumulativeM(path)
    expect(cum[2]).toBeCloseTo(3 * cum[1], 6)
    expect(pointAlong(path, cum, 0).at).toEqual(path[0])
    const half = pointAlong(path, cum, cum[1] / 2)
    expect(half.at.latitude).toBeCloseTo(18.4405, 6)
    expect(half.ahead).toEqual(path[1])
    expect(pointAlong(path, cum, cum[2] + 100).at).toEqual(path[2])
  })

  it('blends longitude the short way across 0°/360°E', () => {
    const path = [at(359.999, 0), at(0.001, 0)]
    const mid = pointAlong(path, cumulativeM(path), cumulativeM(path)[1] / 2).at
    expect(Math.min(mid.longitudeEast, 360 - mid.longitudeEast)).toBeLessThan(1e-6)
  })
})

describe('walkAlong: applyWalkPose', () => {
  const frame = makeFrame(at(77.45))
  const walker = () => ({ xM: 0, yM: 0, yaw: 0.3 })

  it('puts the walker on the pose and faces east when the next point is east', () => {
    const w = walker()
    applyWalkPose(frame, { at: at(77.45), ahead: at(77.451) }, w)
    expect(w.xM).toBeCloseTo(0, 3)
    expect(w.yM).toBeCloseTo(0, 3)
    expect(w.yaw).toBeCloseTo(Math.PI / 2, 3)
  })

  it('faces north for a point north, and keeps its facing when standing still', () => {
    const w = walker()
    applyWalkPose(frame, { at: at(77.45), ahead: at(77.45, 18.441) }, w)
    expect(w.yaw).toBeCloseTo(0, 3)
    const still = walker()
    applyWalkPose(frame, { at: at(77.45), ahead: at(77.45) }, still)
    expect(still.yaw).toBe(0.3)
  })
})

describe('walkAlong: walkFrom', () => {
  const ROUTE = [{ latitude: 18.4, longitudeEast: 77.4 }, { latitude: 18.41, longitudeEast: 77.4 }]

  it('walks only the planned line from an off-route spot, never a line to its start', () => {
    const { path, movedToStart } = walkFrom({ latitude: 18.5, longitudeEast: 77.5 }, ROUTE)
    expect(path).toEqual(ROUTE)
    expect(movedToStart).toBe(true)
  })

  it('moves nobody already on the route start, or whose place is not known yet', () => {
    expect(walkFrom(ROUTE[0], ROUTE).movedToStart).toBe(false)
    expect(walkFrom({ latitude: 18.40001, longitudeEast: 77.4 }, ROUTE).movedToStart).toBe(false)
    expect(walkFrom(null, ROUTE).movedToStart).toBe(false)
  })
})
