import { describe, expect, it } from 'vitest'
import { official, unavailable, type MarsCoordinate, type RoverTraverse, type SurfaceImage, type TraversePoint } from '../../src/domain'
import type { RawImageBatch, SolRange } from '../../src/data/adapters/RawImagesAdapter'
import {
  findStopPhotos,
  noneFoundText,
  noWaypointNearText,
  photosForCard,
  searchStopPhotos,
  STOP_PHOTO_CAMERAS,
  STOP_PHOTO_WAYPOINTS,
  STOP_PHOTOS_READING,
  waypointSolsNear,
  type ReadRawImages,
} from '../../src/app/stopPhotos'
import { TRAVERSE_LOADING_REASON } from '../../src/features/mars-3d/traverseLabel'
import { PHOTOS_NOT_PLACED_REASON, STOP_CARD_PHOTOS } from '../../src/features/mission-ui/stops/stopCardMath'

// Test fixtures only: an invented path and photos, never shown in the app.
const STOP: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
/** About 56 m of longitude per 0.001° at 18.44°N. */
const east = (dLon: number): MarsCoordinate => ({ latitude: 18.44, longitudeEast: 77.45 + dLon })
const waypoint = (site: number, drive: number, sol: number, at: MarsCoordinate): TraversePoint => ({
  coordinate: at,
  sol,
  rmc: { site, drive },
  elevationMeters: unavailable('fixture'),
  tiltDegrees: unavailable('fixture'),
})
const traverse = (points: TraversePoint[]): RoverTraverse => ({ rover: 'perseverance', source: 'fixture', retrievedUtcMs: 0, points })

const PATH = traverse([
  waypoint(3, 0, 10, east(0.001)), // ~56 m
  waypoint(3, 100, 12, east(0.0002)), // ~11 m, the nearest
  waypoint(3, 200, 15, east(0.003)), // ~170 m
  waypoint(3, 300, 20, east(0.03)), // ~1.7 km, out of reach
])

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

const batch = (images: SurfaceImage[], truncated = false) =>
  official<RawImageBatch>({ images, totalResults: truncated ? images.length + 100 : images.length, skipped: 0, truncated, ranDry: false }, 'fixture')

/** A fake feed: photos by sol; records every range asked for. */
function feed(bySol: Record<number, SurfaceImage[]>): ReadRawImages & { asked: SolRange[] } {
  const asked: SolRange[] = []
  const read: ReadRawImages = async (range) => {
    asked.push(range)
    const images: SurfaceImage[] = []
    for (let s = range.fromSol; s <= range.toSol; s++) images.push(...(bySol[s] ?? []))
    return batch(images)
  }
  return Object.assign(read, { asked })
}

const signal = () => new AbortController().signal

describe('waypointSolsNear', () => {
  it('lists the waypoints in reach, nearest first, each to the next waypoint’s sol', () => {
    const near = waypointSolsNear(PATH, STOP, 250)
    expect(near.map((w) => [w.fromSol, w.toSol])).toEqual([
      [12, 15],
      [10, 12],
      [15, 20],
    ])
    expect(near[0].distanceM).toBeLessThan(near[1].distanceM)
  })

  it('gives the last waypoint its own sol', () => {
    const near = waypointSolsNear(traverse([waypoint(1, 0, 7, STOP)]), STOP, 250)
    expect(near).toEqual([{ distanceM: 0, fromSol: 7, toSol: 7 }])
  })

  it('is empty when the rover never stopped in reach', () => {
    expect(waypointSolsNear(PATH, east(0.5), 250)).toEqual([])
  })
})

describe('findStopPhotos', () => {
  it('reads one camera for the nearest waypoint first, and stops once the card is full', async () => {
    const read = feed({ 12: [photo('a', 12, 3, 100), photo('b', 12, 3, 100), photo('c', 13, 3, 100), photo('d', 13, 3, 100)] })
    const found = await findStopPhotos(STOP, PATH, 250, read, signal())
    expect(read.asked).toEqual([{ fromSol: 12, toSol: 15, cameras: STOP_PHOTO_CAMERAS }])
    expect(found.photos).toHaveLength(STOP_CARD_PHOTOS)
  })

  it('never gives the card more than it shows, so its "N more" counts nothing unread', async () => {
    const many = Array.from({ length: 40 }, (_, i) => photo(`p${i}`, 12, 3, 100))
    const found = await findStopPhotos(STOP, PATH, 250, feed({ 12: many }), signal())
    expect(found.photos).toHaveLength(STOP_CARD_PHOTOS)
  })

  it('prefers photos taken at a waypoint over those placed mid-drive, even when the mid-drive ones are nearer', async () => {
    // Drive 150 is between waypoints 100 and 200: placed approximately at drive 100 (~11 m).
    // Drive 0 is a waypoint itself (~56 m): its photos are exact.
    const read = feed({
      12: [photo('mid1', 12, 3, 150), photo('mid2', 12, 3, 150), photo('mid3', 12, 3, 150)],
      10: [photo('at1', 10, 3, 0), photo('at2', 10, 3, 0), photo('at3', 10, 3, 0)],
    })
    const found = await findStopPhotos(STOP, PATH, 250, read, signal())
    expect(found.photos?.map((p) => p.image.id)).toEqual(['at1', 'at2', 'at3'])
    expect(read.asked).toHaveLength(2)
  })

  it('keeps the mid-drive photos when nothing better was found', async () => {
    const found = await findStopPhotos(STOP, PATH, 250, feed({ 12: [photo('mid', 12, 3, 150)] }), signal())
    expect(found.photos?.map((p) => [p.image.id, p.approximate])).toEqual([['mid', true]])
  })

  it(`reads at most ${STOP_PHOTO_WAYPOINTS} waypoints`, async () => {
    const points = Array.from({ length: 6 }, (_, i) => waypoint(3, i * 10, 30 + i, east(0.0001 * i)))
    const read = feed({})
    await findStopPhotos(STOP, traverse(points), 250, read, signal())
    expect(read.asked).toHaveLength(STOP_PHOTO_WAYPOINTS)
  })

  it('never gives the card an empty list: no waypoint in reach says that, not "no photos"', async () => {
    // A mid-drive photo near the stop is placed at its last waypoint, which may be out of reach.
    const read = feed({})
    expect(await findStopPhotos(east(0.5), PATH, 250, read, signal())).toEqual({ photos: null, reason: noWaypointNearText(250) })
    expect(noWaypointNearText(250)).toBe('No rover waypoint within 250 m, so no rover photo can be placed near this stop')
    expect(read.asked).toHaveLength(0)
  })

  it('finding none in what was read is not "none": it says what was not searched', async () => {
    const found = await findStopPhotos(STOP, PATH, 250, feed({}), signal())
    expect(found).toEqual({
      photos: null,
      reason: 'No NAVCAM_LEFT photos were found at the 3 nearest rover waypoints. Not searched: other cameras.',
    })
  })

  it('says how many farther waypoints were left unread', async () => {
    const points = Array.from({ length: 5 }, (_, i) => waypoint(3, i * 10, 30 + i, east(0.0001 * i)))
    const found = await findStopPhotos(STOP, traverse(points), 250, feed({}), signal())
    if (found.photos !== null) throw new Error('expected no photos')
    expect(found.reason).toBe('No NAVCAM_LEFT photos were found at the 3 nearest rover waypoints. Not searched: other cameras, 2 farther waypoints.')
  })

  it('says when a span was cut short, as its arrival photos may be among those not read', async () => {
    // Newest first: the page held only the departure sol's photos, placed at the next waypoint, out of reach.
    const cut: ReadRawImages = async (range) => batch(range.fromSol === 12 ? [photo('later', 15, 3, 300)] : [], range.fromSol === 12)
    const found = await findStopPhotos(STOP, PATH, 250, cut, signal())
    if (found.photos !== null) throw new Error('expected no photos')
    expect(found.reason).toMatch(/Not searched: other cameras, older photos at 1 of these waypoints\.$/)
  })

  it('a search that throws says so, never leaves the card reading', async () => {
    const throwing: ReadRawImages = async () => {
      throw new Error('boom')
    }
    expect(await searchStopPhotos(STOP, PATH, 250, throwing, signal())).toEqual({
      photos: null,
      reason: 'The rover photos could not be placed: boom',
    })
  })

  it('a failed read gives its reason, never "none"', async () => {
    const failing: ReadRawImages = async () => unavailable('Perseverance raw images failed to load: HTTP 503')
    expect(await findStopPhotos(STOP, PATH, 250, failing, signal())).toEqual({
      photos: null,
      reason: 'Perseverance raw images failed to load: HTTP 503',
    })
  })
})

describe('noneFoundText', () => {
  it('writes one sentence, singular where it should be', () => {
    expect(noneFoundText(1, 1, 1)).toBe(
      'No NAVCAM_LEFT photos were found at the nearest rover waypoint. Not searched: other cameras, 1 farther waypoint, older photos at 1 of these waypoints.',
    )
  })
})

describe('photosForCard', () => {
  const found = { photos: [] }

  it('passes null with PHOTOS_NOT_PLACED_REASON when the rover path was not read', () => {
    expect(photosForCard(unavailable('HTTP 503'), found)).toEqual({ photos: null, reason: PHOTOS_NOT_PLACED_REASON })
  })

  it('reads as reading while the path loads, and while the search runs', () => {
    expect(photosForCard(unavailable(TRAVERSE_LOADING_REASON), null)).toEqual({ photos: null, reason: STOP_PHOTOS_READING })
    expect(photosForCard(official(PATH, 'fixture'), null)).toEqual({ photos: null, reason: STOP_PHOTOS_READING })
  })

  it('gives the search’s answer once the path is read', () => {
    expect(photosForCard(official(PATH, 'fixture'), found)).toBe(found)
  })
})
