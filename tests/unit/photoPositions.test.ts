import { describe, expect, it } from 'vitest'
import {
  official,
  unavailable,
  type MarsCoordinate,
  type RoverId,
  type RoverMotionCounter,
  type RoverTraverse,
  type SurfaceImage,
  type TraversePoint,
} from '../../src/domain'
import {
  APPROXIMATE_POSITION,
  indexTraverse,
  isApproximatePosition,
  photosNear,
  positionFromTraverse,
  positionImages,
} from '../../src/features/route-analysis/photoPositions'

// Test fixtures only: an invented traverse and photos, never shown in the app.
const at = (dLon: number): MarsCoordinate => ({ latitude: 18.44, longitudeEast: 77.45 + dLon })
const point = (site: number, drive: number, dLon: number, sol = 100): TraversePoint => ({
  coordinate: at(dLon),
  sol,
  rmc: { site, drive },
  elevationMeters: unavailable('fixture'),
  tiltDegrees: unavailable('fixture'),
})
const TRAVERSE: RoverTraverse = {
  rover: 'perseverance',
  source: 'fixture feed',
  retrievedUtcMs: 0,
  // Out of drive order on purpose: the index sorts.
  points: [point(3, 0, 0), point(3, 500, 0.002), point(3, 120, 0.001), point(4, 10, 0.003, 101)],
}
const image = (id: string, rmc: RoverMotionCounter | null, rover: RoverId = 'perseverance'): SurfaceImage => ({
  id,
  rover,
  sol: 100,
  camera: 'NAVCAM_RIGHT',
  takenUtcMs: unavailable('fixture'),
  takenLocalMeanSolarTime: unavailable('fixture'),
  rmc: rmc === null ? unavailable('the feed says "UNK"') : official(rmc, 'fixture feed'),
  thumbnailUrl: 'fixture',
  fullUrl: 'fixture',
  credit: 'NASA/JPL-Caltech',
  position: unavailable('not joined yet'),
})
const index = indexTraverse(TRAVERSE)

describe('positionFromTraverse', () => {
  it('places a photo exactly at the waypoint with the same site and drive, DERIVED with the join', () => {
    const p = positionFromTraverse(official({ site: 3, drive: 120 }, 'fixture'), index)
    expect(p.classification).toBe('DERIVED')
    if (p.classification !== 'DERIVED') return
    expect(p.value).toEqual(at(0.001))
    expect(p.method).toContain('site 3, drive 120')
    expect(p.method).toContain('same site and drive (sol 100)')
    expect(p.method).toContain('fixture feed')
    expect(p.method.startsWith(APPROXIMATE_POSITION)).toBe(false)
  })

  it('places a photo between waypoints at the nearest earlier one on its site, marked approximate', () => {
    const p = positionFromTraverse(official({ site: 3, drive: 300 }, 'fixture'), index)
    expect(p.classification === 'DERIVED' && p.value).toEqual(at(0.001))
    expect(p.classification === 'DERIVED' && p.method).toMatch(/^Approximate position: .*drive 120/)
    // Past the site's last waypoint: still that last one.
    const late = positionFromTraverse(official({ site: 3, drive: 9000 }, 'fixture'), index)
    expect(late.classification === 'DERIVED' && late.value).toEqual(at(0.002))
  })

  it('never borrows a waypoint from another site', () => {
    // Site 4 starts at drive 10: drive 5 has no earlier waypoint there, even though site 3 has many.
    const p = positionFromTraverse(official({ site: 4, drive: 5 }, 'fixture'), index)
    expect(p.classification).toBe('UNAVAILABLE')
    expect(p.classification === 'UNAVAILABLE' && p.reason).toMatch(/no waypoint on site 4 at or before drive 5/)
  })

  it('is UNAVAILABLE for a site the traverse never had, or a photo with no site/drive', () => {
    const p = positionFromTraverse(official({ site: 99, drive: 0 }, 'fixture'), index)
    expect(p.classification === 'UNAVAILABLE' && p.reason).toMatch(/no waypoint on site 99/)
    const unk = positionFromTraverse(unavailable('the feed says "UNK"'), index)
    expect(unk).toEqual(unavailable('No site/drive for this photo: the feed says "UNK"'))
  })

  it('takes the first published waypoint when two share a site and drive', () => {
    const dup = indexTraverse({ ...TRAVERSE, points: [point(5, 1, 0.01, 200), point(5, 1, 0.02, 201)] })
    const p = positionFromTraverse(official({ site: 5, drive: 1 }, 'fixture'), dup)
    expect(p.classification === 'DERIVED' && p.value).toEqual(at(0.01))
  })
})

describe('positionImages', () => {
  it('positions each photo from its own rover\'s traverse, and leaves the rest UNAVAILABLE', () => {
    const out = positionImages(
      [image('a', { site: 3, drive: 0 }), image('b', null), image('c', { site: 3, drive: 0 }, 'curiosity')],
      [TRAVERSE],
    )
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(out[0].position.classification).toBe('DERIVED')
    expect(out[1].position.classification).toBe('UNAVAILABLE')
    expect(out[2].position).toEqual(unavailable('No curiosity traverse was read, so this photo cannot be placed'))
  })

  it('leaves the photo itself untouched', () => {
    const before = image('a', { site: 3, drive: 0 })
    const [after] = positionImages([before], [TRAVERSE])
    expect({ ...after, position: before.position }).toEqual(before)
    expect(before.position.classification).toBe('UNAVAILABLE')
  })
})

describe('photosNear', () => {
  const placed = positionImages(
    [
      image('far', { site: 4, drive: 10 }),
      image('exact', { site: 3, drive: 120 }),
      image('approx', { site: 3, drive: 130 }),
      image('start', { site: 3, drive: 0 }),
      image('unk', null),
    ],
    [TRAVERSE],
  )

  it('gives the photos within the radius, nearest first, with their distance', () => {
    // 0.001° of longitude at 18.44°N is about 56 m.
    const near = photosNear(placed, at(0.001), 100)
    expect(near.map((n) => n.image.id)).toEqual(['exact', 'approx', 'start'])
    const metres = near.map((n) => (n.distanceM.classification === 'DERIVED' ? n.distanceM.value : Number.NaN))
    expect(metres[0]).toBeCloseTo(0, 6)
    expect(metres[2]).toBeGreaterThan(50)
    expect(metres[2]).toBeLessThan(60)
  })

  it('states the method of each distance, carrying how the photo was placed', () => {
    const [exact, approx] = photosNear(placed, at(0.001), 1)
    expect(exact.distanceM.classification === 'DERIVED' && exact.distanceM.method).toMatch(/Great-circle.*same site and drive/)
    expect(approx.distanceM.classification === 'DERIVED' && approx.distanceM.method).toMatch(/Great-circle.*Approximate position/)
  })

  it('says which positions are approximate', () => {
    const near = photosNear(placed, at(0.001), 1)
    expect(near.map((n) => [n.image.id, n.approximate])).toEqual([
      ['exact', false],
      ['approx', true],
    ])
  })

  it('gives the strip the same answer for one photo', () => {
    const byId = new Map(placed.map((i) => [i.id, i.position]))
    expect(isApproximatePosition(byId.get('approx') ?? unavailable('missing'))).toBe(true)
    expect(isApproximatePosition(byId.get('exact') ?? unavailable('missing'))).toBe(false)
    expect(isApproximatePosition(byId.get('unk') ?? unavailable('missing'))).toBe(false)
  })

  it('never counts an unplaced photo, and gives nothing for an empty list', () => {
    expect(photosNear(placed, at(0), 1e9).map((n) => n.image.id)).not.toContain('unk')
    expect(photosNear([], at(0), 1e9)).toEqual([])
  })
})
