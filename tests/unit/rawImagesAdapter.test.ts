import { describe, expect, it } from 'vitest'
import { isAvailable, unavailable, type RoverTraverse } from '../../src/domain'
import {
  loadRawImages,
  parseRawImagesPage,
  RAW_IMAGES_CREDIT,
  rawImagesUrl,
  readRawImage,
  type RawImageBatch,
} from '../../src/data/adapters/RawImagesAdapter'
import type { JsonIo } from '../../src/data/adapters/TraverseAdapter'
import { positionImages } from '../../src/features/route-analysis/photoPositions'
import { feedPage, MASTCAM_RECORD, pastTheEnd, PIXL_RECORD } from '../fixtures/rawImagesFeed'

const signal = () => new AbortController().signal
const withId = (n: number) => ({ ...PIXL_RECORD, imageid: `IMG_${n}` })

/** A feed holding `total` images, served `per` at a time; records every URL asked for. */
function fakeFeed(total: number, per = 100): JsonIo & { urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    async fetchJson(url) {
      urls.push(url)
      const page = Number(new URL(url).searchParams.get('page'))
      const from = page * per
      if (from >= total) return pastTheEnd(total, page)
      const images = Array.from({ length: Math.min(per, total - from) }, (_, i) => withId(from + i))
      return feedPage(images, total, page)
    },
  }
}

const batch = (v: Awaited<ReturnType<typeof loadRawImages>>): RawImageBatch => {
  if (!isAvailable(v)) throw new Error(v.reason)
  return v.value
}

describe('readRawImage', () => {
  it('reads a recorded record: ids, sol, site/drive from text, UTC with no zone, LMST', () => {
    const image = readRawImage(PIXL_RECORD)
    expect(image).not.toBeNull()
    expect(image).toMatchObject({
      id: 'PCS_0600_0720244903_000ECM_N030000020853606902300LUJ',
      rover: 'perseverance',
      sol: 600,
      camera: 'PIXL_MCC',
      credit: 'NASA/JPL-Caltech',
      thumbnailUrl: PIXL_RECORD.image_files.small,
      fullUrl: PIXL_RECORD.image_files.full_res,
    })
    expect(image?.rmc).toMatchObject({ classification: 'OFFICIAL', value: { site: 30, drive: 0 } })
    expect(image?.takenUtcMs).toMatchObject({ classification: 'OFFICIAL', value: Date.UTC(2022, 9, 28, 16, 10, 13, 365) })
    expect(image?.takenLocalMeanSolarTime).toMatchObject({ classification: 'OFFICIAL', value: '23:15:09.867' })
    expect(image?.caption?.startsWith("NASA's Mars Perseverance rover")).toBe(true)
  })

  it('never takes a position from the feed: UNAVAILABLE until the traverse join', () => {
    const image = readRawImage(PIXL_RECORD)
    expect(image?.position.classification).toBe('UNAVAILABLE')
  })

  it('keeps the instrument team in the credit, and falls back to NASA/JPL-Caltech', () => {
    expect(readRawImage(MASTCAM_RECORD)?.credit).toBe('NASA/JPL-Caltech/ASU')
    expect(readRawImage({ ...MASTCAM_RECORD, credit: undefined })?.credit).toBe(RAW_IMAGES_CREDIT)
    expect(readRawImage({ ...MASTCAM_RECORD, credit: '  ' })?.credit).toBe(RAW_IMAGES_CREDIT)
  })

  it('"UNK" site or drive makes the motion counter UNAVAILABLE, never 0', () => {
    for (const record of [
      { ...PIXL_RECORD, drive: 'UNK' },
      { ...PIXL_RECORD, site: 'UNK' },
      { ...PIXL_RECORD, drive: undefined },
    ]) {
      const rmc = readRawImage(record)?.rmc
      expect(rmc?.classification).toBe('UNAVAILABLE')
    }
    expect(readRawImage({ ...PIXL_RECORD, site: '30', drive: 1004 })?.rmc).toMatchObject({
      value: { site: 30, drive: 1004 },
    })
  })

  it('"UNK" or missing times become UNAVAILABLE, and the photo is still shown', () => {
    const image = readRawImage({ ...PIXL_RECORD, date_taken_utc: 'UNK', date_taken_mars: 'UNK' })
    expect(image?.takenUtcMs.classification).toBe('UNAVAILABLE')
    expect(image?.takenLocalMeanSolarTime.classification).toBe('UNAVAILABLE')
  })

  it('reads sol as text too', () => {
    expect(readRawImage({ ...PIXL_RECORD, sol: '600' })?.sol).toBe(600)
  })

  it('cannot show a record with no id, sol, thumbnail or full image', () => {
    expect(readRawImage({ ...PIXL_RECORD, imageid: '' })).toBeNull()
    expect(readRawImage({ ...PIXL_RECORD, sol: 'UNK' })).toBeNull()
    expect(readRawImage({ ...PIXL_RECORD, image_files: { full_res: PIXL_RECORD.image_files.full_res } })).toBeNull()
    expect(readRawImage({ ...PIXL_RECORD, image_files: { small: PIXL_RECORD.image_files.small } })).toBeNull()
    expect(readRawImage(null)).toBeNull()
  })

  it('falls back to the medium and large sizes', () => {
    const { small, full_res, ...rest } = PIXL_RECORD.image_files
    void small
    void full_res
    const image = readRawImage({ ...PIXL_RECORD, image_files: rest })
    expect(image?.thumbnailUrl).toBe(rest.medium)
    expect(image?.fullUrl).toBe(rest.large)
  })
})

describe('parseRawImagesPage', () => {
  it('counts unreadable records instead of dropping them silently', () => {
    const page = parseRawImagesPage(feedPage([PIXL_RECORD, { imageid: 'broken' }, MASTCAM_RECORD], 3))
    expect(page).toMatchObject({ skipped: 1, totalResults: 3 })
    if (typeof page === 'string') throw new Error(page)
    expect(page.images.map((i) => i.id)).toEqual([PIXL_RECORD.imageid, MASTCAM_RECORD.imageid])
  })

  it('every record carries a credit', () => {
    const page = parseRawImagesPage(feedPage([PIXL_RECORD, MASTCAM_RECORD, { ...PIXL_RECORD, imageid: 'X', credit: null }], 3))
    if (typeof page === 'string') throw new Error(page)
    for (const image of page.images) expect(image.credit.startsWith('NASA/JPL-Caltech')).toBe(true)
  })

  it('says what is wrong with a response that is not a page', () => {
    expect(parseRawImagesPage({})).toBe('no image list in the response')
    expect(parseRawImagesPage({ images: [] })).toMatch(/no total_results/)
  })

  it('tells a broken record without an id apart by its content', () => {
    const page = parseRawImagesPage(feedPage([{ sol: 1 }, { sol: 2 }, { sol: 1 }], 3))
    if (typeof page === 'string') throw new Error(page)
    expect(new Set(page.skippedKeys).size).toBe(2)
  })

  it('reads a page past the end as empty', () => {
    expect(parseRawImagesPage(pastTheEnd(3, 1))).toEqual({ images: [], skipped: 0, skippedKeys: [], totalResults: 3 })
  })
})

describe('loadRawImages', () => {
  it('asks for the sol range in the form the feed pages', () => {
    const url = new URL(rawImagesUrl({ fromSol: 590, toSol: 600 }, 2))
    expect(url.searchParams.get('condition_2')).toBe('590:sol:gte')
    expect(url.searchParams.get('condition_3')).toBe('600:sol:lte')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('num')).toBe('100')
  })

  it('pages until the feed runs out', async () => {
    const io = fakeFeed(250)
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(io.urls).toHaveLength(3)
    expect(result).toMatchObject({ totalResults: 250, skipped: 0, truncated: false, ranDry: false })
    expect(result.images).toHaveLength(250)
  })

  it('stops on an exact multiple of the page size without asking past the end', async () => {
    const io = fakeFeed(200)
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(io.urls).toHaveLength(2)
    expect(result.images).toHaveLength(200)
  })

  it('says when the page cap cut it short', async () => {
    const io = fakeFeed(1024)
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io, 3))
    expect(io.urls).toHaveLength(3)
    expect(result).toMatchObject({ totalResults: 1024, truncated: true })
    expect(result.images).toHaveLength(300)
  })

  it('an empty range is OFFICIAL and empty, not a failure', async () => {
    const result = batch(await loadRawImages({ fromSol: 5, toSol: 5 }, signal(), fakeFeed(0)))
    expect(result).toMatchObject({ images: [], totalResults: 0, truncated: false })
  })

  it('a page repeated by the live feed is not shown twice', async () => {
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        const ids = page === 0 ? [0, 1] : [1, 2]
        return feedPage(ids.map(withId), 3, page)
      },
    }
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(result.images.map((i) => i.id)).toEqual(['IMG_0', 'IMG_1', 'IMG_2'])
  })

  it('a failed page makes the whole read UNAVAILABLE with the reason', async () => {
    const io: JsonIo = {
      async fetchJson() {
        throw new Error('HTTP 503')
      },
    }
    const result = await loadRawImages({ fromSol: 1, toSol: 2 }, signal(), io)
    expect(result).toEqual(unavailable('Perseverance raw images failed to load: HTTP 503'))
  })

  it('refuses a range that is not one', async () => {
    const result = await loadRawImages({ fromSol: 10, toSol: 2 }, signal(), fakeFeed(0))
    expect(result.classification).toBe('UNAVAILABLE')
  })

  it('a cancelled read says so and asks for nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const io = fakeFeed(10)
    const result = await loadRawImages({ fromSol: 1, toSol: 1 }, controller.signal, io)
    expect(result).toEqual(unavailable('Perseverance raw images failed to load: Cancelled'))
    expect(io.urls).toHaveLength(0)
  })

  it('a sol outside the range fails the read: the feed ignored its filter', async () => {
    // On the live feed, a condition the feed cannot read is dropped without an error.
    const result = await loadRawImages({ fromSol: 300, toSol: 300 }, signal(), fakeFeed(5))
    expect(result.classification).toBe('UNAVAILABLE')
    if (result.classification === 'UNAVAILABLE') expect(result.reason).toMatch(/sol 600 for sols 300–300/)
  })

  it('says when the feed ran dry before its own total', async () => {
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page === 0 ? feedPage([withId(0), withId(1)], 3, 0) : pastTheEnd(3, page)
      },
    }
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(result).toMatchObject({ totalResults: 3, truncated: false, ranDry: true })
    expect(result.images).toHaveLength(2)
  })

  it('a repeated unreadable record does not end the read before the last image', async () => {
    // The range holds three images and one broken record; the feed repeats the broken one.
    const broken = { imageid: 'BROKEN' }
    const pages = [[withId(0), broken], [broken, withId(1)], [withId(2)]]
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page < pages.length ? feedPage(pages[page], 4, page) : pastTheEnd(4, page)
      },
    }
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(result.images.map((i) => i.id)).toEqual(['IMG_0', 'IMG_1', 'IMG_2'])
    expect(result.ranDry).toBe(false)
  })

  it('an image listed readable, then broken on a later page, is counted once', async () => {
    // Three in the range: IMG_0 (readable on page 0, broken on page 1), IMG_1, and one never listed.
    const pages = [[withId(0)], [{ imageid: 'IMG_0' }, withId(1)]]
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page < pages.length ? feedPage(pages[page], 3, page) : pastTheEnd(3, page)
      },
    }
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(result.images.map((i) => i.id)).toEqual(['IMG_0', 'IMG_1'])
    expect(result).toMatchObject({ skipped: 0, ranDry: true })
  })

  it('under a camera filter, an image listed named, then unnamed, is counted once', async () => {
    const { camera: _camera, ...unnamed } = PIXL_RECORD
    const second = { ...PIXL_RECORD, imageid: 'SECOND' }
    const pages = [[PIXL_RECORD], [unnamed, second]]
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page < pages.length ? feedPage(pages[page], 3, page) : pastTheEnd(3, page)
      },
    }
    const result = batch(await loadRawImages({ fromSol: 600, toSol: 600, cameras: ['PIXL_MCC'] }, signal(), io))
    expect(result.images.map((i) => i.id)).toEqual([PIXL_RECORD.imageid, 'SECOND'])
    expect(result).toMatchObject({ skipped: 0, ranDry: true })
  })

  it('a broken record without an id, repeated across pages, is counted once', async () => {
    // Three in the range: one image, one id-less broken record listed twice, one never listed.
    const pages = [[withId(0), { sol: 600 }], [{ sol: 600 }]]
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page < pages.length ? feedPage(pages[page], 3, page) : pastTheEnd(3, page)
      },
    }
    expect(batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))).toMatchObject({ skipped: 1, ranDry: true })
  })

  it('counts a repeated broken record once, so a read missing an image never looks complete', async () => {
    // Four in the range: two images, one broken record the feed lists twice, and one image it never lists.
    const broken = { imageid: 'BROKEN' }
    const pages = [[withId(0), broken], [broken, withId(1)]]
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page < pages.length ? feedPage(pages[page], 4, page) : pastTheEnd(4, page)
      },
    }
    const dry = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io))
    expect(dry).toMatchObject({ skipped: 1, ranDry: true })
    const capped = batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io, 2))
    expect(capped).toMatchObject({ skipped: 1, truncated: true })
  })

  it('refuses a page cap below one rather than report a count it never read', async () => {
    const io = fakeFeed(10)
    const result = await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io, 0)
    expect(result.classification).toBe('UNAVAILABLE')
    expect(io.urls).toHaveLength(0)
  })

  it('reads total_results sent as text', async () => {
    const io: JsonIo = {
      async fetchJson() {
        return { ...feedPage([withId(0)], 1), total_results: '1' }
      },
    }
    expect(batch(await loadRawImages({ fromSol: 600, toSol: 600 }, signal(), io)).images).toHaveLength(1)
  })
})

describe('rawImagesUrl', () => {
  it('never sends the feed a sol it would drop', () => {
    expect(() => rawImagesUrl({ fromSol: Number.NaN, toSol: 600 }, 0)).toThrow(RangeError)
    expect(() => rawImagesUrl({ fromSol: 1.5, toSol: 600 }, 0)).toThrow(RangeError)
    expect(() => rawImagesUrl({ fromSol: 600, toSol: 600 }, -1)).toThrow(RangeError)
  })
})

describe('times and credit', () => {
  it('reads a UTC time that already has its Z, and refuses an offset rather than misread it', () => {
    expect(readRawImage({ ...PIXL_RECORD, date_taken_utc: '2022-10-28T16:10:13.365Z' })?.takenUtcMs).toMatchObject({
      value: Date.UTC(2022, 9, 28, 16, 10, 13, 365),
    })
    expect(readRawImage({ ...PIXL_RECORD, date_taken_utc: '2022-10-28T16:10:13+00:00' })?.takenUtcMs.classification).toBe(
      'UNAVAILABLE',
    )
  })

  it("cites the image's own credit on its OFFICIAL fields", () => {
    const image = readRawImage(MASTCAM_RECORD)
    expect(image?.rmc).toMatchObject({ source: expect.stringMatching(/^NASA\/JPL-Caltech\/ASU, /) })
    expect(image?.takenUtcMs).toMatchObject({ source: expect.stringMatching(/^NASA\/JPL-Caltech\/ASU, /) })
  })
})

describe('with the traverse join', () => {
  it('a parsed photo is placed at its site/drive waypoint', () => {
    const image = readRawImage(PIXL_RECORD)
    if (image === null) throw new Error('fixture did not parse')
    // Test fixture only: one waypoint at site 30, drive 0.
    const traverse: RoverTraverse = {
      rover: 'perseverance',
      source: 'fixture',
      retrievedUtcMs: 0,
      points: [
        {
          coordinate: { latitude: 18.45, longitudeEast: 77.4 },
          sol: 593,
          rmc: { site: 30, drive: 0 },
          elevationMeters: unavailable('fixture'),
          tiltDegrees: unavailable('fixture'),
        },
      ],
    }
    const [placed] = positionImages([image], [traverse])
    expect(placed.position).toMatchObject({ classification: 'DERIVED', value: { latitude: 18.45, longitudeEast: 77.4 } })
  })
})

describe('camera filter', () => {
  const onlyCamera = (camera: string): JsonIo => ({
    async fetchJson() {
      return feedPage([{ ...PIXL_RECORD, camera: { instrument: camera } }], 1)
    },
  })

  it('asks the feed for the cameras as search=A|B', () => {
    const url = new URL(rawImagesUrl({ fromSol: 13, toSol: 14, cameras: ['NAVCAM_LEFT', 'MCZ_LEFT'] }, 0))
    expect(url.searchParams.get('search')).toBe('NAVCAM_LEFT|MCZ_LEFT')
    expect(new URL(rawImagesUrl({ fromSol: 13, toSol: 14 }, 0)).searchParams.has('search')).toBe(false)
  })

  it('refuses a camera list it would not send as asked', async () => {
    expect(() => rawImagesUrl({ fromSol: 1, toSol: 1, cameras: [] }, 0)).toThrow(RangeError)
    expect(() => rawImagesUrl({ fromSol: 1, toSol: 1, cameras: ['navcam left'] }, 0)).toThrow(RangeError)
    const result = await loadRawImages({ fromSol: 600, toSol: 600, cameras: ['a|b'] }, signal(), onlyCamera('PIXL_MCC'))
    expect(result.classification === 'UNAVAILABLE' && result.reason).toMatch(/not a camera list/)
  })

  it('a record that names no camera is counted, not shown, and does not fail the page', async () => {
    const { camera: _camera, ...unnamed } = PIXL_RECORD
    const io: JsonIo = {
      async fetchJson(url) {
        const page = Number(new URL(url).searchParams.get('page'))
        return page === 0 ? feedPage([{ ...unnamed, imageid: 'NO_CAMERA' }, PIXL_RECORD], 2) : pastTheEnd(2, page)
      },
    }
    const result = await loadRawImages({ fromSol: 600, toSol: 600, cameras: ['PIXL_MCC'] }, signal(), io)
    if (result.classification === 'UNAVAILABLE') throw new Error(result.reason)
    expect(result.value.images.map((i) => i.id)).toEqual([PIXL_RECORD.imageid])
    expect(result.value).toMatchObject({ skipped: 1, ranDry: false })
  })

  it('a camera not asked for fails the read: the feed ignored its filter', async () => {
    const result = await loadRawImages({ fromSol: 600, toSol: 600, cameras: ['NAVCAM_LEFT'] }, signal(), onlyCamera('PIXL_MCC'))
    expect(result.classification).toBe('UNAVAILABLE')
    if (result.classification === 'UNAVAILABLE') expect(result.reason).toMatch(/camera PIXL_MCC for NAVCAM_LEFT/)
  })

  it('names the cameras in the source', async () => {
    const result = await loadRawImages({ fromSol: 600, toSol: 600, cameras: ['PIXL_MCC'] }, signal(), onlyCamera('PIXL_MCC'))
    expect(result).toMatchObject({ classification: 'OFFICIAL', source: expect.stringMatching(/sols 600–600, PIXL_MCC$/) })
  })
})
