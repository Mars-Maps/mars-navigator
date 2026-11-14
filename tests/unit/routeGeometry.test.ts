import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { MarsCoordinate } from '../../src/domain'
import {
  draftWaypoints,
  greatCirclePath,
  hasRouteLine,
  pathDotStride,
  resamplePath,
} from '../../src/features/mars-3d/routeGeometry'
import { coordinateToLocalPoint } from '../../src/features/mars-3d/projection'

const R = 3.3895
const DEG = Math.PI / 180

// Positions are Float32: angle checks allow 1e-6 rad.
function vertices(positions: Float32Array): Vector3[] {
  const out = []
  for (let i = 0; i < positions.length; i += 3) {
    out.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]))
  }
  return out
}

function at(c: MarsCoordinate, radius = R) {
  return coordinateToLocalPoint(c, radius)
}

const A: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const B: MarsCoordinate = { latitude: 0, longitudeEast: 90 }
const C: MarsCoordinate = { latitude: 45, longitudeEast: 90 }

describe('routeGeometry: draftWaypoints', () => {
  it('orders departure, stops, destination and labels each', () => {
    const points = draftWaypoints({ departure: A, stops: [B, C], destination: A })
    expect(points.map((p) => p.kind)).toEqual(['departure', 'stop', 'stop', 'destination'])
    expect(points[1].coordinate).toBe(B)
  })

  it('skips ends that are not chosen yet', () => {
    expect(draftWaypoints({ departure: null, stops: [B], destination: null })).toEqual([
      { kind: 'stop', coordinate: B },
    ])
    expect(draftWaypoints({ departure: null, stops: [], destination: null })).toEqual([])
  })
})

describe('routeGeometry: hasRouteLine', () => {
  it('needs two chosen waypoints', () => {
    expect(hasRouteLine({ departure: A, stops: [], destination: null })).toBe(false)
    expect(hasRouteLine({ departure: A, stops: [], destination: B })).toBe(true)
    expect(hasRouteLine({ departure: null, stops: [A, B], destination: null })).toBe(true)
  })
})

describe('routeGeometry: greatCirclePath', () => {
  it('keeps every vertex on the sphere, so no chord cuts the planet', () => {
    for (const v of vertices(greatCirclePath([A, B, C], R))) {
      expect(v.length()).toBeCloseTo(R, 6)
    }
  })

  it('starts and ends exactly on the waypoints and passes through stops', () => {
    const vs = vertices(greatCirclePath([A, B, C], R))
    expect(vs[0].distanceTo(at(A))).toBeLessThan(1e-5)
    expect(vs.at(-1)!.distanceTo(at(C))).toBeLessThan(1e-5)
    expect(vs.some((v) => v.distanceTo(at(B)) < 1e-5)).toBe(true)
  })

  it('never steps more than the maximum angle', () => {
    const vs = vertices(greatCirclePath([A, B, C], R, 1))
    for (let i = 1; i < vs.length; i++) {
      expect(vs[i - 1].angleTo(vs[i])).toBeLessThanOrEqual(1 * DEG + 1e-6)
    }
    // 90° then 45°: 135 steps plus the start.
    expect(vs.length).toBe(136)
  })

  it('follows the great circle: the midpoint of a 90° equator leg is 45°E', () => {
    const vs = vertices(greatCirclePath([A, B], R, 1))
    expect(vs[45].distanceTo(at({ latitude: 0, longitudeEast: 45 }))).toBeLessThan(1e-5)
  })

  it('crosses the 0°/360° seam the short way', () => {
    const vs = vertices(
      greatCirclePath(
        [
          { latitude: 0, longitudeEast: 350 },
          { latitude: 0, longitudeEast: 10 },
        ],
        R,
        1,
      ),
    )
    expect(vs.length).toBe(21)
    expect(vs[10].distanceTo(at(A))).toBeLessThan(1e-5)
  })

  it('joins exact antipodes along some great circle, on the sphere', () => {
    const north: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
    const south: MarsCoordinate = { latitude: 0, longitudeEast: 180 }
    const vs = vertices(greatCirclePath([north, south], R, 1))
    expect(vs.length).toBe(181)
    expect(vs.at(-1)!.distanceTo(at(south))).toBeLessThan(1e-5)
    for (const v of vs) expect(v.length()).toBeCloseTo(R, 6)
    for (let i = 1; i < vs.length; i++) {
      expect(vs[i - 1].angleTo(vs[i])).toBeLessThanOrEqual(1 * DEG + 1e-6)
    }
  })

  it('joins pole to pole without failing', () => {
    const vs = vertices(
      greatCirclePath(
        [
          { latitude: 90, longitudeEast: 0 },
          { latitude: -90, longitudeEast: 0 },
        ],
        R,
      ),
    )
    expect(vs.length).toBe(181)
    for (const v of vs) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true)
  })

  it('adds nothing for a repeated waypoint', () => {
    expect(greatCirclePath([A, A], R).length).toBe(3)
    expect(greatCirclePath([A, A, B], R, 1).length).toBe(greatCirclePath([A, B], R, 1).length)
  })

  it('returns nothing for no waypoints and one vertex for one', () => {
    expect(greatCirclePath([], R).length).toBe(0)
    expect(greatCirclePath([A], R).length).toBe(3)
  })
})

describe('routeGeometry: resamplePath', () => {
  it('spaces points evenly along the path, on the sphere', () => {
    const strip = greatCirclePath([A, B, C], R, 1)
    const step = 0.05
    const vs = vertices(resamplePath(strip, step, R))
    expect(vs[0].distanceTo(at(A))).toBeLessThan(1e-5)
    for (const v of vs) expect(v.length()).toBeCloseTo(R, 5)
    // Spacing is along the path; straight-line gaps are shorter only across
    // the 90° turn at B (0.05 × cos 45° there).
    const gaps = vs.slice(1).map((v, i) => vs[i].distanceTo(v))
    const off = gaps.filter((g) => Math.abs(g - step) > 1e-3)
    expect(off.length).toBe(1)
    expect(off[0]).toBeGreaterThan(step * 0.7)
    // 135° of arc at radius R, one point per step, plus the start.
    expect(vs.length).toBe(Math.floor((135 * DEG * R) / step) + 1)
  })

  it('returns nothing for an empty path or a bad step', () => {
    expect(resamplePath(new Float32Array(), 0.1, R).length).toBe(0)
    expect(resamplePath(greatCirclePath([A, B], R), 0, R).length).toBe(0)
  })
})

describe('routeGeometry: pathDotStride', () => {
  it('shows every point when zoomed right in', () => {
    expect(pathDotStride(0.01, 0.002, 0.014)).toBe(1)
  })

  it('is a power of two that grows with altitude', () => {
    let last = 1
    for (const altitude of [0.2, 1, 5, 25]) {
      const stride = pathDotStride(altitude, 0.002, 0.014)
      expect(Math.log2(stride) % 1).toBe(0)
      expect(stride).toBeGreaterThanOrEqual(last)
      last = stride
    }
    expect(last).toBeGreaterThan(64)
  })
})
