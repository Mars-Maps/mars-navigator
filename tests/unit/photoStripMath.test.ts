import { describe, expect, it } from 'vitest'
import { derived, official, unavailable, type SurfaceImage } from '../../src/domain'
import { bySol, countText, page, pathPhotos, STRIP_PAGE, type PathPhoto } from '../../src/features/mission-ui/photos/photoStripMath'
import { APPROXIMATE_POSITION, photosNear } from '../../src/features/route-analysis/photoPositions'

// Test fixtures only — invented images, sols and times, never shown in the app.
const photo = (id: string, sol: number, takenUtcMs: number | null = null): PathPhoto => ({
  image: {
    id,
    rover: 'perseverance',
    sol,
    camera: 'FIXTURE_CAM',
    takenUtcMs: takenUtcMs === null ? unavailable('fixture') : official(takenUtcMs, 'fixture'),
    takenLocalMeanSolarTime: unavailable('fixture'),
    rmc: unavailable('fixture'),
    thumbnailUrl: `https://example.invalid/${id}-thumb.jpg`,
    fullUrl: `https://example.invalid/${id}.jpg`,
    credit: 'fixture-credit',
    position: derived({ latitude: 18, longitudeEast: 77 }, 'fixture-join'),
  } satisfies SurfaceImage,
  approximate: false,
})
const ids = (photos: PathPhoto[]) => photos.map((p) => p.image.id)

describe('bySol', () => {
  it('puts the oldest sol first', () => {
    expect(ids(bySol([photo('c', 30), photo('a', 10), photo('b', 20)]))).toEqual(['a', 'b', 'c'])
  })

  it('orders one sol by the time taken, unknown times last, then by id', () => {
    const sorted = bySol([photo('z', 5), photo('late', 5, 2000), photo('y', 5), photo('early', 5, 1000)])
    expect(ids(sorted)).toEqual(['early', 'late', 'y', 'z'])
  })

  it('shows a photo that arrives twice once', () => {
    expect(ids(bySol([photo('a', 1), photo('b', 2), photo('a', 1)]))).toEqual(['a', 'b'])
  })

  it('leaves its input as it was', () => {
    const input = [photo('b', 2), photo('a', 1)]
    bySol(input)
    expect(ids(input)).toEqual(['b', 'a'])
  })
})

describe('page', () => {
  it('gives the first count and how many remain', () => {
    const items = Array.from({ length: 95 }, (_, i) => i)
    expect(page(items, STRIP_PAGE)).toEqual({ shown: items.slice(0, 40), remaining: 55 })
    expect(page(items, 120)).toEqual({ shown: items, remaining: 0 })
    expect(page([], STRIP_PAGE)).toEqual({ shown: [], remaining: 0 })
  })
})

describe('countText', () => {
  it('says how many show, in sol order', () => {
    expect(countText(40, 312)).toBe('Showing 40 of 312, oldest sol first')
    expect(countText(12, 12)).toBe('12 photos, oldest sol first')
    expect(countText(1, 1)).toBe('1 photo, oldest sol first')
  })
})

describe('pathPhotos and the photo join', () => {
  const at = (id: string, position: SurfaceImage['position']): SurfaceImage => ({ ...photo(id, 1).image, position })

  it("marks a photo approximate by the join's own test, and keeps an unplaced one, not approximate", () => {
    const out = pathPhotos([
      at('exact', derived({ latitude: 18, longitudeEast: 77 }, 'fixture-join')),
      at('approx', derived({ latitude: 18, longitudeEast: 77 }, `${APPROXIMATE_POSITION}: fixture-earlier-waypoint`)),
      at('unplaced', unavailable('fixture-no-site-drive')),
    ])
    expect(out.map((p) => [p.image.id, p.approximate])).toEqual([
      ['exact', false],
      ['approx', true],
      ['unplaced', false],
    ])
  })

  it("takes a stop's photosNear output as a list of path photos, unchanged", () => {
    const near: PathPhoto[] = photosNear([at('a', derived({ latitude: 18, longitudeEast: 77 }, 'fixture-join'))], { latitude: 18, longitudeEast: 77 }, 200)
    expect(ids(near)).toEqual(['a'])
  })
})
