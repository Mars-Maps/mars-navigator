import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { official, unavailable, type TraversePoint } from '../../src/domain'
import { nearestOnScreen, traversePositions } from '../../src/features/mars-3d/traverseGeometry'
import { pointsThroughSol, solRange } from '../../src/features/mars-3d/traverseSols'
import { coordinateToLocalPoint } from '../../src/features/mars-3d/projection'

const R = 3.3895

// Test fixture only: invented positions and sols, not Perseverance's feed.
function point(sol: number, latitude: number, longitudeEast: number): TraversePoint {
  return {
    coordinate: { latitude, longitudeEast },
    sol,
    rmc: { site: 1, drive: sol },
    elevationMeters: official(-2500, 'test fixture'),
    tiltDegrees: unavailable('test fixture'),
  }
}

const POINTS = [
  point(10, 18.44, 77.45),
  point(10, 18.441, 77.452),
  point(12, 18.443, 77.455),
  point(15, 18.446, 77.46),
  point(15, 18.448, 77.462),
  point(20, 18.45, 77.47),
]

describe('traverseGeometry: traversePositions', () => {
  it('puts one vertex per waypoint at its coordinate on the sphere', () => {
    const positions = traversePositions(POINTS, R)
    expect(positions.length).toBe(POINTS.length * 3)
    const third = new Vector3().fromArray(positions, 2 * 3)
    const expected = coordinateToLocalPoint(POINTS[2].coordinate, R)
    expect(third.distanceTo(expected)).toBeLessThan(1e-6)
  })

  it('is empty for an empty feed', () => {
    expect(traversePositions([], R).length).toBe(0)
  })
})

describe('traverseGeometry: solRange', () => {
  it('reads the first and last sol', () => {
    expect(solRange(POINTS)).toEqual({ first: 10, last: 20 })
  })

  it('is null for an empty feed', () => {
    expect(solRange([])).toBeNull()
  })
})

describe('traverseGeometry: pointsThroughSol', () => {
  it('counts every waypoint reached by the end of the sol', () => {
    expect(pointsThroughSol(POINTS, 10)).toBe(2)
    expect(pointsThroughSol(POINTS, 14)).toBe(3)
    expect(pointsThroughSol(POINTS, 15)).toBe(5)
    expect(pointsThroughSol(POINTS, 20)).toBe(6)
  })

  it('is zero before the first sol and all after the last', () => {
    expect(pointsThroughSol(POINTS, 9)).toBe(0)
    expect(pointsThroughSol(POINTS, 1000)).toBe(6)
    expect(pointsThroughSol([], 10)).toBe(0)
  })
})

describe('traverseGeometry: nearestOnScreen', () => {
  // x, y per waypoint; the third is behind the globe.
  const screen = new Float32Array([10, 10, 20, 10, NaN, NaN, 30, 10, 30, 10])

  it('finds the closest shown waypoint within reach', () => {
    expect(nearestOnScreen(screen, 5, 19, 11, 6)).toBe(1)
  })

  it('ignores waypoints the slider hides', () => {
    expect(nearestOnScreen(screen, 1, 19, 11, 6)).toBeNull()
    expect(nearestOnScreen(screen, 0, 10, 10, 6)).toBeNull()
  })

  it('never picks a waypoint behind the globe', () => {
    expect(nearestOnScreen(screen, 3, 0, 0, 1000)).toBe(0)
  })

  it('names the newest of two waypoints in the same place', () => {
    expect(nearestOnScreen(screen, 5, 30, 10, 6)).toBe(4)
  })

  it('is null when nothing is within reach', () => {
    expect(nearestOnScreen(screen, 5, 200, 200, 6)).toBeNull()
  })
})
