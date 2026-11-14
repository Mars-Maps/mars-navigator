import { describe, expect, it } from 'vitest'
import {
  official,
  unavailable,
  type MarsCoordinate,
  type RoverTraverse,
  type SurfaceImage,
  type TraversePoint,
  type WalkPlan,
} from '../../src/domain'
import type { RawImageBatch, SolRange } from '../../src/data/adapters/RawImagesAdapter'
import { noWaypointNearText, type ReadRawImages, type StopPhotos } from '../../src/app/stopPhotos'
import { answersFor, searchWalkPhotos, walkPhotosFrom, walkPhotosScope } from '../../src/app/useWalkPhotos'
import { TRAVERSE_LOADING_REASON } from '../../src/features/mars-3d/traverseLabel'
import {
  PHOTOS_NEED_A_WALK,
  WALK_PHOTOS_NOT_PLACED_REASON,
  WALK_PHOTOS_READING,
} from '../../src/features/mission-ui/photos/photoStripMath'

// Test fixtures only: an invented path, stops and photos, never shown in the app.
/** About 56 m of longitude per 0.001° at 18.44°N. */
const east = (dLon: number): MarsCoordinate => ({ latitude: 18.44, longitudeEast: 77.45 + dLon })
const waypoint = (site: number, drive: number, sol: number, at: MarsCoordinate): TraversePoint => ({
  coordinate: at,
  sol,
  rmc: { site, drive },
  elevationMeters: unavailable('fixture'),
  tiltDegrees: unavailable('fixture'),
})
const PATH: RoverTraverse = {
  rover: 'perseverance',
  source: 'fixture',
  retrievedUtcMs: 0,
  points: [waypoint(3, 100, 12, east(0)), waypoint(3, 200, 15, east(0.003)), waypoint(3, 300, 20, east(0.05))],
}
const photo = (id: string, sol: number, site: number, drive: number): SurfaceImage => ({
  id,
  rover: 'perseverance',
  sol,
  camera: 'NAVCAM_LEFT',
  takenUtcMs: unavailable('fixture'),
  takenLocalMeanSolarTime: unavailable('fixture'),
  rmc: official({ site, drive }, 'fixture'),
  thumbnailUrl: 'https://example.invalid/t.jpg',
  fullUrl: 'https://example.invalid/f.png',
  credit: 'NASA/JPL-Caltech',
  position: unavailable('fixture'),
})

/** A fake feed: photos by sol; records every range asked for. */
function feed(bySol: Record<number, SurfaceImage[]>): ReadRawImages & { asked: SolRange[] } {
  const asked: SolRange[] = []
  const read: ReadRawImages = async (range) => {
    asked.push(range)
    const images: SurfaceImage[] = []
    for (let s = range.fromSol; s <= range.toSol; s++) images.push(...(bySol[s] ?? []))
    return official<RawImageBatch>({ images, totalResults: images.length, skipped: 0, truncated: false, ranDry: false }, 'fixture')
  }
  return Object.assign(read, { asked })
}

const signal = () => new AbortController().signal
// Stop A sits on the first waypoint, stop B ~170 m from it, stop C ~1.7 km from any.
const STOPS = [{ coordinate: east(0) }, { coordinate: east(0.003) }, { coordinate: east(0.03) }]

describe('searchWalkPhotos', () => {
  it("answers every stop in walking order with the stop card's own search", async () => {
    const read = feed({ 12: [photo('a', 12, 3, 100)], 15: [photo('b', 15, 3, 200)] })
    const answers = await searchWalkPhotos(STOPS, PATH, 250, read, signal())
    expect(answers).toHaveLength(3)
    expect(answers[0].photos?.map((p) => p.image.id)).toContain('a')
    expect(answers[1].photos?.map((p) => p.image.id)).toContain('b')
    expect(answers[2]).toEqual({ photos: null, reason: noWaypointNearText(250) })
  })

  it('stops asking once aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const read = feed({})
    expect(await searchWalkPhotos(STOPS, PATH, 250, read, controller.signal)).toEqual([])
    expect(read.asked).toEqual([])
  })

  // An abort while stop 1 is being read leaves stop 2 unasked.
  it('aborted while the first stop reads, answers that stop and asks nothing for the next', async () => {
    const bySol = { 12: [photo('a', 12, 3, 100)], 15: [photo('b', 15, 3, 200)] }
    const firstStopAlone = feed(bySol)
    await searchWalkPhotos(STOPS.slice(0, 1), PATH, 250, firstStopAlone, signal())

    const controller = new AbortController()
    const inner = feed(bySol)
    const read: ReadRawImages = (range, s) => {
      controller.abort()
      return inner(range, s)
    }
    const answers = await searchWalkPhotos(STOPS, PATH, 250, read, controller.signal)
    expect(answers).toHaveLength(1)
    expect(answers[0].photos?.map((p) => p.image.id)).toContain('a')
    expect(inner.asked).toEqual(firstStopAlone.asked)
  })
})

// The hook's guard against a previous plan's (or radius's) answer.
describe('answersFor', () => {
  // Only identity is compared, so a partial plan is enough; the cast says so.
  const plan = (label: string) => ({ stops: [{ label, coordinate: east(0) }] }) as unknown as WalkPlan
  const answers: StopPhotos[] = [{ photos: null, reason: 'fixture-why' }]

  it("gives the stored answers for the plan and radius they were searched for", () => {
    const p = plan('A')
    expect(answersFor({ plan: p, radiusM: 250, answers }, p, 250)).toBe(answers)
  })

  it('treats a previous plan\'s answer as still reading, even one with the same stops', () => {
    const old = plan('A')
    expect(answersFor({ plan: old, radiusM: 250, answers }, plan('A'), 250)).toBeNull()
  })

  it('treats an answer for another radius as still reading', () => {
    const p = plan('A')
    expect(answersFor({ plan: p, radiusM: 100, answers }, p, 250)).toBeNull()
  })

  it('with no answer yet, or no plan, gives null', () => {
    expect(answersFor(null, plan('A'), 250)).toBeNull()
    expect(answersFor({ plan: plan('A'), radiusM: 250, answers }, null, 250)).toBeNull()
  })
})

describe('walkPhotosFrom', () => {
  const placed = (id: string): StopPhotos => ({
    photos: [{ image: { ...photo(id, 12, 3, 100), position: official(east(0), 'fixture') }, distanceM: official(0, 'fixture'), approximate: false }],
  })

  it('before a walk is planned, asks for one rather than saying there are no photos', () => {
    expect(walkPhotosFrom(false, official(PATH, 'fixture'), null)).toEqual({ images: null, reason: PHOTOS_NEED_A_WALK, stopReasons: [] })
  })

  it("while the rover's path loads or the stops are searched, says it is reading", () => {
    expect(walkPhotosFrom(true, unavailable(TRAVERSE_LOADING_REASON), null).reason).toBe(WALK_PHOTOS_READING)
    expect(walkPhotosFrom(true, official(PATH, 'fixture'), null).reason).toBe(WALK_PHOTOS_READING)
  })

  it("with the rover's path failed, says no photo could be placed", () => {
    const w = walkPhotosFrom(true, unavailable('fixture feed failed'), null)
    expect(w).toEqual({ images: null, reason: WALK_PHOTOS_NOT_PLACED_REASON, stopReasons: [] })
  })

  it("gives every photo found once, and each empty stop's reason by its index", () => {
    const w = walkPhotosFrom(true, official(PATH, 'fixture'), [placed('a'), placed('a'), { photos: null, reason: 'fixture-why' }])
    expect(w.images?.map((i) => i.id)).toEqual(['a'])
    expect(w.stopReasons).toEqual([null, null, 'fixture-why'])
    expect(w.reason).toBeUndefined()
  })

  it('with every stop empty, gives an empty list and all the reasons, never a bare "none"', () => {
    const w = walkPhotosFrom(true, official(PATH, 'fixture'), [{ photos: null, reason: 'r1' }, { photos: null, reason: 'r2' }])
    expect(w.images).toEqual([])
    expect(w.stopReasons).toEqual(['r1', 'r2'])
  })
})

// The strip's count is capped by the stop card's search, so it says so.
describe('walkPhotosScope', () => {
  it("states the stop card's limit and cameras, and that it is not every photo", () => {
    expect(walkPhotosScope()).toBe(
      "Up to 3 NAVCAM_LEFT photos found per stop, from its nearest rover waypoints; a stop's filter also shows " +
        'those another stop found within 250 m of this stop. Not every photo taken there',
    )
    expect(walkPhotosScope(5, ['A', 'B'], 1200)).toContain('Up to 5 A, B photos found per stop')
    expect(walkPhotosScope(5, ['A', 'B'], 1200)).toContain('within 1.2 km of this stop')
  })

  // The cap is per search; a stop's filter can hold more, and the line must not say otherwise.
  it('never says a stop holds at most the cap', () => {
    expect(walkPhotosScope()).not.toMatch(/at each stop/)
  })
})
