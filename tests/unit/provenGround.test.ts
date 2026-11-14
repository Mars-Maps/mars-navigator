import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM, derived, official, unavailable, type MarsCoordinate, type RoverTraverse } from '../../src/domain'
import {
  describeProvenGround,
  distanceToPathKm,
  farthestFromRoverPath,
  provenGround,
} from '../../src/features/route-analysis/provenGround'

// Test fixtures only: an invented rover path near Jezero, never shown in the app.
const ORIGIN: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
/** A point `x` km east and `y` km north of the origin. */
const at = (x: number, y: number, o = ORIGIN): MarsCoordinate => ({
  latitude: o.latitude + y / KM_PER_DEG_LAT,
  longitudeEast: (o.longitudeEast + x / (KM_PER_DEG_LAT * Math.cos(o.latitude * RAD)) + 360) % 360,
})
/** A rover that drove 2 km east along y = 0, in three waypoints. */
const traverse = (coords: MarsCoordinate[]): RoverTraverse => ({
  rover: 'perseverance',
  source: 'fixture feed',
  retrievedUtcMs: 0,
  points: coords.map((coordinate, i) => ({
    coordinate,
    sol: i,
    rmc: { site: 1, drive: i },
    elevationMeters: unavailable('fixture'),
    tiltDegrees: unavailable('fixture'),
  })),
})
const ROVER = traverse([at(0, 0), at(1, 0), at(2, 0)])
const value = (c: { classification: string; value?: number }) => (c.classification === 'DERIVED' ? c.value : null)

describe('provenGround', () => {
  it('gives an on-path stretch a small bound: a quarter of its length, rounded up', () => {
    const [d] = provenGround([at(0.2, 0), at(0.4, 0)], ROVER)
    expect(d.classification).toBe('DERIVED')
    // 200 m stretch on the path: 0 + 200/4, rounded up, so floating error can only make it 51.
    expect(value(d)).toBeGreaterThanOrEqual(50)
    expect(value(d)).toBeLessThanOrEqual(51)
  })

  it('gives a near stretch its offset plus the quarter-length margin', () => {
    const [d] = provenGround([at(0.5, 0.1), at(0.7, 0.1)], ROVER)
    expect(value(d)).toBeGreaterThanOrEqual(150)
    expect(value(d)).toBeLessThanOrEqual(151)
  })

  it('gives a far stretch the distance to the nearest part of the path, even past its end', () => {
    const [d] = provenGround([at(3, 0), at(3, 0.2)], ROVER)
    // Farthest measured point (3, 0.2) is hypot(1, 0.2) km from the end (2, 0), plus 50 m.
    expect(value(d)).toBeCloseTo(Math.ceil((Math.hypot(1, 0.2) + 0.05) * 1000), -1)
  })

  it('bounds every point of a stretch, not only its ends', () => {
    // A stretch crossing the path diagonally: both ends 300 m off, its middle on the path.
    const path = [at(1, -0.3), at(1.4, 0.3)]
    const [d] = provenGround(path, ROVER)
    for (let t = 0; t <= 1; t += 0.05) {
      const p = { latitude: path[0].latitude + t * (path[1].latitude - path[0].latitude), longitudeEast: path[0].longitudeEast + t * (path[1].longitudeEast - path[0].longitudeEast) }
      expect(distanceToPathKm(p, ROVER.points.map((q) => q.coordinate)) * 1000).toBeLessThanOrEqual(value(d)!)
    }
  })

  it('gives one value per stretch, in order', () => {
    const out = provenGround([at(0, 0), at(0, 0.5), at(0, 2)], ROVER)
    expect(out).toHaveLength(2)
    expect(value(out[0])!).toBeLessThan(value(out[1])!)
  })

  it('states the method, and says it is not a safety statement', () => {
    const [d] = provenGround([at(0, 0), at(0.1, 0)], ROVER)
    expect(d.classification === 'DERIVED' && d.method).toMatch(/straight lines between its published waypoints/)
    expect(d.classification === 'DERIVED' && d.method).toMatch(/not ground known to be safe/)
    expect(d.classification === 'DERIVED' && d.method).toContain('fixture feed')
  })

  it('is UNAVAILABLE for a traverse with no waypoints, and empty for a path with no stretch', () => {
    expect(provenGround([at(0, 0), at(1, 0)], traverse([]))[0].classification).toBe('UNAVAILABLE')
    expect(provenGround([at(0, 0)], ROVER)).toEqual([])
    expect(provenGround([], ROVER)).toEqual([])
  })

  it('measures to a single-waypoint traverse as a point', () => {
    const [d] = provenGround([at(0, 1), at(0, 1)], traverse([at(0, 0)]))
    expect(value(d)).toBe(1000)
  })

  it('works across 0/360°E', () => {
    const o = { latitude: 0, longitudeEast: 0.001 }
    const rover = traverse([at(-1, 0, o), at(1, 0, o)])
    expect(rover.points[0].coordinate.longitudeEast).toBeGreaterThan(359)
    const [d] = provenGround([at(0, 0.1, o), at(0, 0.1, o)], rover)
    expect(value(d)).toBe(100)
  })
})

describe('describeProvenGround', () => {
  it('says "within", never "safe", in metres or km', () => {
    expect(describeProvenGround(40)).toBe('within 40 m of the rover path')
    expect(describeProvenGround(1234, 'Perseverance')).toBe('within 1.3 km of the Perseverance path')
    expect(describeProvenGround(40.2)).toBe('within 41 m of the rover path')
    expect(describeProvenGround(999)).not.toMatch(/safe/i)
  })
})

describe('distanceToPathKm', () => {
  it('measures the fixture spacing: 1 km east is 1 km', () => {
    expect(distanceToPathKm(at(0, 0), [at(1, 0)])).toBeCloseTo(1, 3)
  })
})

describe('farthestFromRoverPath', () => {
  const read = official(ROVER, 'fixture feed')

  it('takes the largest stretch, so no point of the leg is farther, and names the method', () => {
    // Walks away from the path: stretch ends 0.1, 0.5 and 1 km north of it.
    const path = [at(1, 0.1), at(1, 0.5), at(1, 1)]
    const stretches = provenGround(path, ROVER).map(value) as number[]
    const leg = farthestFromRoverPath(derived(path, 'fixture'), read)
    expect(leg.classification).toBe('DERIVED')
    expect(value(leg)).toBe(Math.max(...stretches))
    expect(value(leg)).toBeGreaterThanOrEqual(1000)
    expect(JSON.stringify(leg)).toContain("The largest over this leg's 2 stretches")
    expect(JSON.stringify(leg)).toContain('Distance only')
  })

  it('is UNAVAILABLE, never 0, when the rover path was not read', () => {
    const leg = farthestFromRoverPath(derived([at(0, 0), at(1, 0)], 'fixture'), unavailable('fixture: 503'))
    expect(leg.classification).toBe('UNAVAILABLE')
    expect(JSON.stringify(leg)).toContain('fixture: 503')
  })

  it('is UNAVAILABLE when the leg has no line, or no stretch', () => {
    const none = farthestFromRoverPath(unavailable('fixture: no path'), read)
    expect(none.classification).toBe('UNAVAILABLE')
    expect(JSON.stringify(none)).toContain('fixture: no path')
    expect(farthestFromRoverPath(derived([at(0, 0)], 'fixture'), read).classification).toBe('UNAVAILABLE')
  })

  it('is UNAVAILABLE when the traverse has no waypoints', () => {
    const empty = official(traverse([]), 'fixture feed')
    expect(farthestFromRoverPath(derived([at(0, 0), at(1, 0)], 'fixture'), empty).classification).toBe('UNAVAILABLE')
  })
})
