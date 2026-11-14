import { describe, expect, it } from 'vitest'
import type { MarsCoordinate } from '../../src/domain'
import {
  SNAP_RADIUS_PX,
  landDrop,
  pointOnSegment,
  snapNote,
  snapToPath,
  surfaceMetres,
  type ScreenPoint,
} from '../../src/features/mars-3d/surfaceView/snapToRoute'

describe('snapToPath: the nearest point of the line on the screen', () => {
  const line: ScreenPoint[] = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
  ]

  it('a drop 10 px from the line snaps to the foot of the perpendicular', () => {
    const snap = snapToPath({ x: 200, y: 110 }, line, SNAP_RADIUS_PX)
    expect(snap).toEqual({ index: 0, t: 0.5, distancePx: 10 })
  })

  it('a drop 200 px away does not snap', () => {
    expect(snapToPath({ x: 200, y: 300 }, line, SNAP_RADIUS_PX)).toBeNull()
  })

  it('past the end of the line it snaps to the end, within the radius', () => {
    expect(snapToPath({ x: 310, y: 100 }, line, SNAP_RADIUS_PX)).toEqual({ index: 0, t: 1, distancePx: 10 })
    expect(snapToPath({ x: 400, y: 100 }, line, SNAP_RADIUS_PX)).toBeNull()
  })

  it('a route of two legs snaps to the nearer leg', () => {
    const bent: ScreenPoint[] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]
    expect(snapToPath({ x: 290, y: 250 }, bent, SNAP_RADIUS_PX)).toEqual({ index: 1, t: 0.75, distancePx: 10 })
    expect(snapToPath({ x: 150, y: 92 }, bent, SNAP_RADIUS_PX)).toEqual({ index: 0, t: 0.25, distancePx: 8 })
  })

  it('skips segments whose vertex is behind the globe, and a line of one point', () => {
    const hidden: (ScreenPoint | null)[] = [{ x: 100, y: 100 }, null, { x: 300, y: 100 }]
    expect(snapToPath({ x: 200, y: 100 }, hidden, SNAP_RADIUS_PX)).toBeNull()
    expect(snapToPath({ x: 100, y: 100 }, [{ x: 100, y: 100 }], SNAP_RADIUS_PX)).toBeNull()
    expect(snapToPath({ x: 100, y: 100 }, [], SNAP_RADIUS_PX)).toBeNull()
  })

  it('a zero-length segment snaps to its point', () => {
    expect(snapToPath({ x: 105, y: 100 }, [{ x: 100, y: 100 }, { x: 100, y: 100 }], SNAP_RADIUS_PX)).toEqual({ index: 0, t: 0, distancePx: 5 })
  })
})

describe('pointOnSegment: along the great circle between two route points', () => {
  const a: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.4 }
  const b: MarsCoordinate = { latitude: 18.5, longitudeEast: 77.6 }

  it('the ends are the ends', () => {
    expect(pointOnSegment(a, b, 0).latitude).toBeCloseTo(a.latitude, 9)
    expect(pointOnSegment(a, b, 0).longitudeEast).toBeCloseTo(a.longitudeEast, 9)
    expect(pointOnSegment(a, b, 1).latitude).toBeCloseTo(b.latitude, 9)
    expect(pointOnSegment(a, b, 1).longitudeEast).toBeCloseTo(b.longitudeEast, 9)
  })

  it('the middle is halfway in distance from both ends', () => {
    const mid = pointOnSegment(a, b, 0.5)
    expect(surfaceMetres(a, mid)).toBeCloseTo(surfaceMetres(mid, b), 6)
    expect(surfaceMetres(a, mid) + surfaceMetres(mid, b)).toBeCloseTo(surfaceMetres(a, b), 6)
  })

  it('crosses 0°E without a detour', () => {
    const w: MarsCoordinate = { latitude: 0, longitudeEast: 359.9 }
    const e: MarsCoordinate = { latitude: 0, longitudeEast: 0.1 }
    const mid = pointOnSegment(w, e, 0.5)
    expect(mid.latitude).toBeCloseTo(0, 9)
    expect(Math.min(mid.longitudeEast, 360 - mid.longitudeEast)).toBeCloseTo(0, 9)
  })
})

describe('surfaceMetres: great-circle distance on the mean sphere', () => {
  it('one degree of latitude is about 59.2 km on Mars', () => {
    expect(surfaceMetres({ latitude: 0, longitudeEast: 10 }, { latitude: 1, longitudeEast: 10 })).toBeCloseTo((3389.5 * 1000 * Math.PI) / 180, 3)
  })
})

describe('snapNote', () => {
  it('says the walker was moved, in metres under a kilometre and in km above', () => {
    expect(snapNote(340.4)).toBe('Snapped to the route, 340 m')
    expect(snapNote(0.4)).toBe('Snapped to the route, 0 m')
    expect(snapNote(1240)).toBe('Snapped to the route, 1.2 km')
  })
})

describe('landDrop: where the walker lands', () => {
  // A projection fixture: one screen pixel per 0.001°, x east, y south.
  const project = (c: MarsCoordinate): ScreenPoint => ({ x: c.longitudeEast * 1000, y: -c.latitude * 1000 })
  const path: MarsCoordinate[] = [
    { latitude: 18.4, longitudeEast: 77.4 },
    { latitude: 18.4, longitudeEast: 77.5 },
    { latitude: 18.5, longitudeEast: 77.5 },
  ]

  it('a drop near the line lands on it and says how far it moved', () => {
    const drop: MarsCoordinate = { latitude: 18.41, longitudeEast: 77.45 }
    const landing = landDrop(drop, project(drop), path, project)
    // The great circle between two points on one parallel bows a few metres poleward of it.
    expect(landing.at.latitude).toBeCloseTo(18.4, 4)
    expect(landing.at.longitudeEast).toBeCloseTo(77.45, 4)
    expect(landing.note).toMatch(/^Snapped to the route, \d+ m$/)
    // 0.01° of latitude is about 592 m.
    expect(landing.note).toBe(`Snapped to the route, ${Math.round(surfaceMetres(drop, landing.at))} m`)
    expect(surfaceMetres(drop, landing.at)).toBeCloseTo(591.6, 0)
  })

  it('a drop far from the line lands where it is, with no note', () => {
    const drop: MarsCoordinate = { latitude: 18.6, longitudeEast: 77.45 }
    expect(landDrop(drop, project(drop), path, project)).toEqual({ at: drop, note: null })
  })

  it('no path, a path of one point, or a path all behind the globe: no snap', () => {
    const drop: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.45 }
    expect(landDrop(drop, project(drop), null, project)).toEqual({ at: drop, note: null })
    expect(landDrop(drop, project(drop), [path[0]], project)).toEqual({ at: drop, note: null })
    expect(landDrop(drop, project(drop), path, () => null)).toEqual({ at: drop, note: null })
  })
})
