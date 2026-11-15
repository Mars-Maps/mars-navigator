import { describe, expect, it } from 'vitest'
import type { GeologicFeatures } from '../../src/domain'
import { CRATER_NEAR_KM } from '../../src/features/route-analysis/mappedObstacles'
import { mappedObstaclesAlongPath, mergeFeatures } from '../../src/features/route-analysis/routeObstacles'
import { MAP, at, line, xyOf } from './terrain.helpers'

const features = (f: Partial<GeologicFeatures>): GeologicFeatures => ({ points: [], lines: [], areas: [], ...f })
const crater = (x: number, y: number) => ({ kind: 'small crater', at: at(x, y), map: MAP })
const box = (x0: number, x1: number, y0: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]
const ridged = (x0: number, x1: number, y0: number, y1: number) => ({ kind: 'ridged', rings: [box(x0, x1, y0, y1)], map: MAP })

/** East 2 km, then north 2 km: two stretches with a turn at (2, 0). */
const PATH = [at(0, 0), at(2, 0), at(2, 2)]
const scan = (f: Partial<GeologicFeatures>, path = PATH) => mappedObstaclesAlongPath(path, features(f), 'fastest-leg1')

describe('mappedObstaclesAlongPath', () => {
  it('finds nothing on a clear map, and nothing on a path of one point', () => {
    expect(scan({})).toEqual([])
    expect(scan({ points: [crater(1, 0)] }, [at(0, 0)])).toEqual([])
  })

  it('flags a marked crater beside any stretch once, at the crater, and not one beyond the checked distance', () => {
    const near = CRATER_NEAR_KM / 2
    const hazards = scan({ points: [crater(2 + near, 1), crater(1, 3 * CRATER_NEAR_KM), crater(1, -near)] })
    expect(hazards.map((h) => h.unit)).toEqual(['small crater', 'small crater'])
    // In walking order: beside the first stretch, then beside the second.
    expect(xyOf(hazards[0].coordinate).x).toBeCloseTo(1, 6)
    expect(xyOf(hazards[1].coordinate).y).toBeCloseTo(1, 6)
    expect(hazards.map((h) => h.id)).toEqual(['fastest-leg1-obstacle-1', 'fastest-leg1-obstacle-2'])
    expect(hazards[0]).toMatchObject({ kind: 'mapped-obstacle', magnitude: { classification: 'UNAVAILABLE' } })
    if (hazards[0].magnitude.classification === 'UNAVAILABLE') {
      expect(hazards[0].magnitude.reason).toMatch(/lies about 50 m from the route, inside the 100 m checked/)
      expect(hazards[0].magnitude.reason).toContain(MAP.id)
    }
  })

  it('names a crater at the turn once, though both stretches pass it', () => {
    expect(scan({ points: [crater(2.03, -0.03)] })).toHaveLength(1)
  })

  it('flags ridged ground where the path enters it, once, however many stretches run inside', () => {
    // Entered on the first stretch at x = 1; the turn and the second stretch's start are inside too.
    const hazards = scan({ areas: [ridged(1, 3, -1, 1)] })
    expect(hazards).toHaveLength(1)
    expect(hazards[0].unit).toBe('ridged')
    expect(xyOf(hazards[0].coordinate).x).toBeCloseTo(1, 6)
    expect(xyOf(hazards[0].coordinate).y).toBeCloseTo(0, 6)
  })

  it('flags a path that starts on ridged ground at its start, and each later entry from outside', () => {
    // Starts inside the first box, leaves it, and enters the second on the northward stretch.
    const hazards = scan({ areas: [ridged(-1, 0.5, -1, 1), ridged(1.5, 2.5, 1, 3)] })
    expect(hazards).toHaveLength(2)
    expect(hazards[0].coordinate).toEqual(PATH[0])
    expect(xyOf(hazards[1].coordinate).x).toBeCloseTo(2, 6)
    expect(xyOf(hazards[1].coordinate).y).toBeCloseTo(1, 6)
  })

  it('flags each crossing of a marked line, on either stretch, and ignores other kinds', () => {
    const hazards = scan({
      lines: [
        line('crest of crater rim', [0.5, -1], [0.5, 1]),
        line('delta lobe front', [1, 1], [3, 1]),
        line('channel (fluvial)', [1.2, -1], [1.2, 1]),
      ],
    })
    expect(hazards.map((h) => h.unit)).toEqual(['crest of crater rim', 'delta lobe front'])
    expect(xyOf(hazards[1].coordinate).y).toBeCloseTo(1, 6)
    if (hazards[0].magnitude.classification === 'UNAVAILABLE') {
      expect(hazards[0].magnitude.reason).toMatch(/^The route crosses a line marked "crest of crater rim"/)
    }
  })

  it('names a line crossing the path exactly at its turn once, though it meets both stretches there', () => {
    // From north-west of the turn to south-east of it: through the corner, from one side of the path to the other.
    const through = scan({ lines: [line('delta lobe front', [1, 1], [3, -1])] })
    expect(through).toHaveLength(1)
    expect(xyOf(through[0].coordinate).x).toBeCloseTo(2, 6)
    expect(xyOf(through[0].coordinate).y).toBeCloseTo(0, 6)
  })

  it('measures a crater from the path where the crater is, on a path that starts far away', () => {
    // 60° of latitude north of the start, the first plane's east–west scale is half the ground's.
    const north = { latitude: 78, longitudeEast: 77.5 }
    const kmPerDegLon = (3389.5 * Math.PI) / 180 * Math.cos((78 * Math.PI) / 180)
    const path = [at(0, 0), north, { latitude: 78, longitudeEast: 77.6 }]
    const beside = (km: number) => ({ kind: 'small crater', at: { latitude: 78 + km / ((3389.5 * Math.PI) / 180), longitudeEast: 77.55 }, map: MAP })
    expect(kmPerDegLon * 0.1).toBeGreaterThan(1)
    expect(mappedObstaclesAlongPath(path, features({ points: [beside(0.08)] }), 'x')).toHaveLength(1)
    expect(mappedObstaclesAlongPath(path, features({ points: [beside(0.12)] }), 'x')).toHaveLength(0)
  })

  it('lists what it finds in walking order across kinds', () => {
    const hazards = scan({
      points: [crater(2.05, 1.5)],
      lines: [line('crest of crater rim', [1.5, -1], [1.5, 1])],
      areas: [ridged(0.5, 1, -1, 1)],
    })
    expect(hazards.map((h) => h.unit)).toEqual(['ridged', 'crest of crater rim', 'small crater'])
  })
})

describe('mergeFeatures', () => {
  it('keeps each feature once across reads whose boxes overlap, and every distinct one', () => {
    const a = features({ points: [crater(1, 0), crater(2, 0)], lines: [line('crest of crater rim', [0, 0], [1, 1])], areas: [ridged(0, 1, 0, 1)] })
    const b = features({ points: [crater(2, 0), crater(3, 0)], lines: [line('crest of crater rim', [0, 0], [1, 1]), line('delta lobe front', [0, 0], [1, 1])], areas: [ridged(0, 1, 0, 1), ridged(0, 2, 0, 1)] })
    const merged = mergeFeatures([a, b])
    expect(merged.points.map((f) => xyOf(f.at).x).map(Math.round)).toEqual([1, 2, 3])
    expect(merged.lines.map((f) => f.kind)).toEqual(['crest of crater rim', 'delta lobe front'])
    expect(merged.areas).toHaveLength(2)
    expect(mergeFeatures([])).toEqual({ points: [], lines: [], areas: [] })
  })
})
