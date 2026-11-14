import { describe, expect, it } from 'vitest'
import {
  derived,
  official,
  SUITED_SLOPE_LIMIT,
  unavailable,
  walkPlanProblem,
  type GeologicUnit,
  type SurfaceImage,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import {
  formatDistanceM,
  formatElevation,
  noPhotosText,
  photosToShow,
  photoTitle,
  shownDistance,
  shownElevation,
  STOP_CARD_PHOTOS,
  stopPlanFacts,
} from '../../src/features/mission-ui/stops/stopCardMath'
import type { PhotoNearby } from '../../src/features/route-analysis/photoPositions'

// Test fixtures only — invented images and distances, never shown in the app.
const image = (id: string): SurfaceImage => ({
  id,
  rover: 'perseverance',
  sol: 100,
  camera: 'FIXTURE_CAM',
  takenUtcMs: unavailable('fixture'),
  takenLocalMeanSolarTime: unavailable('fixture'),
  rmc: unavailable('fixture'),
  thumbnailUrl: `https://example.invalid/${id}-thumb.jpg`,
  fullUrl: `https://example.invalid/${id}.jpg`,
  credit: 'fixture-credit',
  position: unavailable('fixture'),
})
const photo = (id: string, m: number | null): PhotoNearby => ({
  image: image(id),
  distanceM: m === null ? unavailable('fixture-no-position') : derived(m, 'fixture-join'),
  approximate: false,
})
const ids = (photos: PhotoNearby[]) => photos.map((p) => p.image.id)

describe('photosToShow', () => {
  it('shows the nearest first, whatever order they arrive in', () => {
    const { shown, more } = photosToShow([photo('c', 150), photo('a', 10), photo('b', 80)], 200)
    expect(ids(shown)).toEqual(['a', 'b', 'c'])
    expect(more).toBe(0)
  })

  it('shows at most STOP_CARD_PHOTOS and counts the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => photo(`p${i}`, i * 10))
    const { shown, more } = photosToShow(many, 200)
    expect(shown).toHaveLength(STOP_CARD_PHOTOS)
    expect(ids(shown)).toEqual(['p0', 'p1', 'p2'])
    expect(more).toBe(4)
  })

  it('leaves out a photo with an unknown distance, or one beyond the radius, rather than calling it near', () => {
    const { shown, more } = photosToShow([photo('far', 250), photo('unknown', null), photo('edge', 200), photo('bad', Number.NaN)], 200)
    expect(ids(shown)).toEqual(['edge'])
    expect(more).toBe(0)
  })

  it('gives nothing for no photos', () => {
    expect(photosToShow([], 200)).toEqual({ shown: [], more: 0 })
  })
})

describe('formatting', () => {
  it('writes distances in metres under 1 km and tenths of a km beyond', () => {
    expect(formatDistanceM(0)).toBe('0 m')
    expect(formatDistanceM(349.6)).toBe('350 m')
    expect(formatDistanceM(999.4)).toBe('999 m')
    expect(formatDistanceM(999.6)).toBe('1.0 km')
    expect(formatDistanceM(1240)).toBe('1.2 km')
  })

  it('writes heights as the elevation chart does', () => {
    expect(formatElevation(-2540.4)).toBe('-2,540 m')
    expect(formatElevation(12)).toBe('12 m')
  })

  it('keeps any finite height, below the areoid too, and makes the rest unavailable', () => {
    expect(shownElevation(official(-2540, 'fixture'))).toEqual(official(-2540, 'fixture'))
    expect(shownElevation(official(Number.NaN, 'fixture')).classification).toBe('UNAVAILABLE')
    expect(shownElevation(official(Number.NEGATIVE_INFINITY, 'fixture')).classification).toBe('UNAVAILABLE')
    expect(shownElevation(unavailable('fixture-why'))).toEqual(unavailable('fixture-why'))
  })

  it('keeps a finite, unsigned distance and makes the rest unavailable', () => {
    expect(shownDistance(derived(0, 'fixture'))).toEqual(derived(0, 'fixture'))
    expect(shownDistance(derived(1.24, 'fixture'))).toEqual(derived(1.24, 'fixture'))
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shownDistance(derived(bad, 'fixture')).classification).toBe('UNAVAILABLE')
    }
  })

  it('names a photo by rover, camera as NASA names it, and sol', () => {
    expect(photoTitle(image('x'))).toBe('Perseverance FIXTURE_CAM, sol 100')
    expect(photoTitle({ ...image('y'), rover: 'curiosity' })).toBe('Curiosity FIXTURE_CAM, sol 100')
  })

  it('says how far it looked when there are no photos', () => {
    expect(noPhotosText(200)).toBe('No rover photos within 200 m')
    expect(noPhotosText(1500)).toBe('No rover photos within 1.5 km')
  })

  it('keeps an OFFICIAL distance too: the class does not decide nearness', () => {
    const p: PhotoNearby = { ...photo('o', null), distanceM: official(40, 'fixture') }
    expect(ids(photosToShow([p], 200).shown)).toEqual(['o'])
  })
})

const UNIT: GeologicUnit = {
  symbol: 'Fx',
  name: 'fixture-unit',
  map: { id: 'FIXTURE', title: 'fixture', scaleDenominator: 75000, citation: 'fixture-citation' },
}
const walkStop = (id: string, longitudeEast: number): WalkStop => ({
  id,
  label: `fixture-${id}`,
  coordinate: { latitude: 18.4, longitudeEast },
  unit: official(UNIT, 'fixture-citation'),
  reason: derived(`fixture-reason-${id}`, 'fixture-goal-table'),
})
const leg = (fromStopId: string, toStopId: string, km: number): WalkLeg => ({
  fromStopId,
  toStopId,
  path: unavailable('fixture'),
  distanceKm: derived(km, 'fixture-route'),
  steepestSlopeDeg: derived(5, 'fixture'),
  hazards: derived([], 'fixture'),
})
const PLAN: WalkPlan = {
  goal: { id: 'fixture-goal', label: 'fixture-goal', unitNames: ['fixture-unit'], reason: derived('fixture', 'fixture') },
  stops: [walkStop('a', 77.5), walkStop('b', 77.51), walkStop('c', 77.52)],
  legs: [leg('a', 'b', 0.6), leg('b', 'c', 1.24)],
  slopeLimit: SUITED_SLOPE_LIMIT,
}

describe('stopPlanFacts', () => {
  it('uses a fixture that keeps the walk-plan contract', () => {
    expect(walkPlanProblem(PLAN)).toBeNull()
  })

  it('takes the stop’s name, unit and reason, the leg into it, and the plan’s slope limit', () => {
    expect(stopPlanFacts(PLAN, 2)).toEqual({
      label: 'fixture-c',
      unit: official(UNIT, 'fixture-citation'),
      reason: derived('fixture-reason-c', 'fixture-goal-table'),
      fromPreviousKm: derived(1.24, 'fixture-route'),
      legSteepestSlopeDeg: derived(5, 'fixture'),
      legHazards: derived([], 'fixture'),
      slopeLimit: SUITED_SLOPE_LIMIT,
    })
  })

  it('has no distance or hazards from a previous stop at the first, where the walk starts', () => {
    expect(stopPlanFacts(PLAN, 0)?.fromPreviousKm).toBeNull()
    expect(stopPlanFacts(PLAN, 0)?.legSteepestSlopeDeg).toBeNull()
    expect(stopPlanFacts(PLAN, 0)?.legHazards).toBeNull()
  })

  it('says so when the plan has no leg into the stop, and gives nothing for a stop it does not have', () => {
    expect(stopPlanFacts({ ...PLAN, legs: [leg('a', 'b', 0.6)] }, 2)?.fromPreviousKm).toEqual(
      unavailable('The plan has no leg into this stop'),
    )
    expect(stopPlanFacts({ ...PLAN, legs: [leg('a', 'b', 0.6)] }, 2)?.legSteepestSlopeDeg).toEqual(
      unavailable('The plan has no leg into this stop'),
    )
    expect(stopPlanFacts({ ...PLAN, legs: [leg('a', 'b', 0.6)] }, 2)?.legHazards).toEqual(
      unavailable('The plan has no leg into this stop'),
    )
    expect(stopPlanFacts(PLAN, 3)).toBeNull()
    expect(stopPlanFacts(PLAN, -1)).toBeNull()
  })
})
