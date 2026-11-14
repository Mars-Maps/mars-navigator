import { describe, expect, it } from 'vitest'
import { derived, unavailable } from '../../src/domain'
import type { ElevationProfileSample } from '../../src/features/route-analysis/elevationProfile'
import {
  elevationExtent,
  nearestSampleIndex,
  routePointOf,
  sampleIndexAtPointer,
  splitAtGaps,
  splitByBand,
  stepIndex,
} from '../../src/features/mission-ui/navigation/profileChart'

// Test fixtures only — invented elevations, not data.
const METHOD = 'test fixture'
const at = (km: number, m: number | null): ElevationProfileSample => ({
  coordinate: { latitude: 0, longitudeEast: km },
  distanceKm: km,
  elevationMeters: m === null ? unavailable('no data') : derived(m, METHOD),
})

describe('splitAtGaps', () => {
  it('breaks the line at an UNAVAILABLE sample instead of joining across it', () => {
    const segments = splitAtGaps([at(0, 10), at(1, 20), at(2, null), at(3, 40), at(4, 50)])
    expect(segments).toEqual([
      [{ km: 0, m: 10 }, { km: 1, m: 20 }],
      [{ km: 3, m: 40 }, { km: 4, m: 50 }],
    ])
  })

  it('never turns a gap into 0', () => {
    const points = splitAtGaps([at(0, 10), at(1, null), at(2, 30)]).flat()
    expect(points.map((p) => p.m)).toEqual([10, 30])
  })

  it('keeps an isolated sample as its own one-point segment', () => {
    const segments = splitAtGaps([at(0, null), at(1, 5), at(2, null)])
    expect(segments).toEqual([[{ km: 1, m: 5 }]])
  })

  it('returns no segments when nothing has elevation', () => {
    expect(splitAtGaps([at(0, null), at(1, null)])).toEqual([])
    expect(splitAtGaps([])).toEqual([])
  })
})

describe('elevationExtent', () => {
  it('reports the real extremes of a flat profile, unpadded', () => {
    expect(elevationExtent(splitAtGaps([at(0, 100), at(1, 100)]))).toEqual({
      min: 100,
      max: 100,
    })
  })

  it('handles negative elevations and ignores gaps', () => {
    expect(elevationExtent(splitAtGaps([at(0, -4000), at(1, null), at(2, 2500)]))).toEqual({
      min: -4000,
      max: 2500,
    })
  })

  it('is null when there is no elevation at all', () => {
    expect(elevationExtent([])).toBeNull()
  })
})

describe('nearestSampleIndex', () => {
  const samples = [at(0, 10), at(2, 20), at(5, null), at(6, 40)]

  it('snaps to the closest real sample', () => {
    expect(nearestSampleIndex(samples, 1.9)).toBe(1)
    expect(nearestSampleIndex(samples, 5.8)).toBe(3)
  })

  it('clamps to the first and last sample outside the route', () => {
    expect(nearestSampleIndex(samples, -3)).toBe(0)
    expect(nearestSampleIndex(samples, 99)).toBe(3)
  })

  it('gives a tie to the earlier sample', () => {
    expect(nearestSampleIndex(samples, 1)).toBe(0)
  })

  it('lands on a gap sample instead of skipping it', () => {
    expect(nearestSampleIndex(samples, 4.9)).toBe(2)
  })

  it('returns the only sample of a one-sample profile', () => {
    expect(nearestSampleIndex([at(3, 10)], 0)).toBe(0)
  })

  it('is -1 when there are no samples', () => {
    expect(nearestSampleIndex([], 1)).toBe(-1)
  })
})

describe('pointer to route point', () => {
  // A 10 km route drawn 200 px wide: 20 px per km.
  const route = [
    { ...at(0, 10), coordinate: { latitude: 18.4, longitudeEast: 77.5 } },
    { ...at(4, 20), coordinate: { latitude: 18.5, longitudeEast: 77.6 } },
    { ...at(7, null), coordinate: { latitude: 18.6, longitudeEast: 77.7 } },
    { ...at(10, 40), coordinate: { latitude: 18.7, longitudeEast: 77.8 } },
  ]
  const pointAt = (offsetPx: number) =>
    routePointOf(route[sampleIndexAtPointer(route, 10, offsetPx, 200)] ?? null)

  it('maps the pointer x to the nearest sample', () => {
    expect(sampleIndexAtPointer(route, 10, 0, 200)).toBe(0)
    expect(sampleIndexAtPointer(route, 10, 85, 200)).toBe(1) // 4.25 km
    expect(sampleIndexAtPointer(route, 10, 200, 200)).toBe(3)
  })

  it('gives that sample’s coordinate and distance from the departure', () => {
    expect(pointAt(85)).toEqual({ coordinate: { latitude: 18.5, longitudeEast: 77.6 }, distanceKm: 4 })
  })

  it('gives a point for a gap sample too: it is still on the route', () => {
    expect(pointAt(140)).toEqual({ coordinate: { latitude: 18.6, longitudeEast: 77.7 }, distanceKm: 7 })
  })

  it('clamps a pointer outside the chart to the ends of the route', () => {
    expect(pointAt(-30)?.distanceKm).toBe(0)
    expect(pointAt(260)?.distanceKm).toBe(10)
  })

  it('is -1 before the chart has a width, and with no samples', () => {
    expect(sampleIndexAtPointer(route, 10, 50, 0)).toBe(-1)
    expect(sampleIndexAtPointer([], 10, 50, 200)).toBe(-1)
  })

  it('has no point when no sample is active', () => {
    expect(routePointOf(null)).toBeNull()
  })
})

describe('stepIndex', () => {
  it('moves one sample and stops at both ends', () => {
    expect(stepIndex(1, 1, 4)).toBe(2)
    expect(stepIndex(3, 1, 4)).toBe(3)
    expect(stepIndex(0, -1, 4)).toBe(0)
  })

  it('starts at the first sample on → and the last on ← when nothing is selected', () => {
    expect(stepIndex(null, 1, 4)).toBe(0)
    expect(stepIndex(null, -1, 4)).toBe(3)
  })

  it('is -1 when there are no samples', () => {
    expect(stepIndex(null, 1, 0)).toBe(-1)
  })
})

describe('splitByBand', () => {
  it('cuts a segment into runs by the band of each stretch, runs sharing their end points', () => {
    // 1 km stretches: 10 m rise is 0.6° (gentle), 150 m is 8.5° (moderate), 400 m is 21.8° (steep).
    const runs = splitByBand([
      { km: 0, m: 0 },
      { km: 1, m: 10 },
      { km: 2, m: 20 },
      { km: 3, m: 170 },
      { km: 4, m: 570 },
      { km: 5, m: 170 },
    ])
    expect(runs.map((r) => r.band)).toEqual(['gentle', 'moderate', 'steep'])
    expect(runs.map((r) => r.points.length)).toEqual([3, 2, 3])
    expect(runs[0].points.at(-1)).toEqual(runs[1].points[0])
    expect(runs[1].points.at(-1)).toEqual(runs[2].points[0])
    // Downhill is as steep as uphill.
    expect(runs[2].points.at(-1)).toEqual({ km: 5, m: 170 })
  })

  it('gives no run for a lone point, and a null band for a stretch with no length', () => {
    expect(splitByBand([{ km: 1, m: 5 }])).toEqual([])
    expect(splitByBand([])).toEqual([])
    expect(splitByBand([{ km: 1, m: 5 }, { km: 1, m: 9 }])).toEqual([{ band: null, points: [{ km: 1, m: 5 }, { km: 1, m: 9 }] }])
  })
})
