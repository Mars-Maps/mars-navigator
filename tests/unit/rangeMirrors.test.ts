import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserElevationIo } from '../../src/data/adapters/ElevationAdapter'
import {
  ASC_PDS_S3,
  ASC_PDS_S3_ADDRESSES,
  mirrorFor,
  mirrorsOf,
} from '../../src/data/adapters/rangeMirrors'
import { ELEVATION_SOURCE } from '../../src/data/elevation/demSources'

/** The global 200 m DEM's key in the bucket, and its row layout as an earlier replay measured it. */
const KEY = 'mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif'
const ROW_STRIDE = 213388
const rowStart = (row: number) => 854272 + row * ROW_STRIDE + 151552

describe('the bucket on several addresses', () => {
  it('names the DEM source’s own address first, then four more, each ending before the key', () => {
    expect(ELEVATION_SOURCE.url.startsWith(ASC_PDS_S3)).toBe(true)
    expect(ASC_PDS_S3_ADDRESSES[0]).toBe(ASC_PDS_S3)
    expect(new Set(ASC_PDS_S3_ADDRESSES).size).toBe(5)
    for (const base of ASC_PDS_S3_ADDRESSES) expect(base).toMatch(/^https:\/\/.*\/$/)
  })

  it('reads a file in the bucket from every address, with the same key', () => {
    const all = mirrorsOf(ASC_PDS_S3 + KEY)
    expect(all).toHaveLength(5)
    expect(all[0]).toBe(ASC_PDS_S3 + KEY)
    for (const url of all) expect(url.endsWith('/' + KEY)).toBe(true)
  })

  it('leaves any other file on its one address', () => {
    expect(mirrorsOf('https://example.org/dem.tif')).toEqual(['https://example.org/dem.tif'])
    expect(mirrorFor('https://example.org/dem.tif', 12345)).toBe('https://example.org/dem.tif')
  })

  it('gives each range one fixed address, so a reread is the same URL and a cache hit', () => {
    // Pinned: a change of the hash or of the list's order moves every cached range to another URL.
    const url = ASC_PDS_S3 + KEY
    const base = (row: number) => mirrorFor(url, rowStart(row)).slice(0, -KEY.length)
    expect(mirrorFor(url, 10)).toBe(url)
    expect(base(0)).toBe('https://asc-pds-services.s3-us-west-2.amazonaws.com/')
    expect(base(2)).toBe('https://s3.us-west-2.amazonaws.com/asc-pds-services/')
    expect(base(41299)).toBe('https://asc-pds-services.s3.amazonaws.com/')
  })

  it('spreads a patch’s 201 row reads over all five addresses, none with more than a quarter of them', () => {
    const url = ASC_PDS_S3 + KEY
    for (const first of [21300, 30000, 40000]) {
      const counts = new Map<string, number>()
      for (let r = 0; r < 201; r++) {
        const host = mirrorFor(url, rowStart(first + r))
        counts.set(host, (counts.get(host) ?? 0) + 1)
      }
      expect(counts.size).toBe(5)
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(50)
    }
  })
})

describe('the browser reads go to the chosen address', () => {
  afterEach(() => vi.unstubAllGlobals())

  const url = ASC_PDS_S3 + KEY
  // Row 0 of the 200 m DEM: a range whose address is not the named one.
  const START = rowStart(0)
  const OTHER = `https://asc-pds-services.s3-us-west-2.amazonaws.com/${KEY}?bytes=${START}-${START + 1}`
  const NAMED = `${url}?bytes=${START}-${START + 1}`
  const partial = () => ({
    status: 206,
    body: null,
    headers: new Headers({ 'Content-Range': `bytes ${START}-${START + 1}/2` }),
    arrayBuffer: async () => new ArrayBuffer(2),
  })
  const answer = (status: number) => ({ status, body: null, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) })
  const read = (signal = new AbortController().signal) => browserElevationIo.fetchRange(url, START, 2, signal)
  const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map((c) => c[0])

  it('fetches a bucket range from its own address, not the named one, with the range in the query and the header', async () => {
    const fetch = vi.fn(async () => partial())
    vi.stubGlobal('fetch', fetch)
    await read()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(OTHER, expect.objectContaining({ headers: { Range: `bytes=${START}-${START + 1}` } }))
  })

  it('reads the range once more from the named address when its own address cannot be reached', async () => {
    const fetch = vi.fn(async (input: string) => {
      if (input === OTHER) throw new TypeError('Failed to fetch')
      return partial()
    })
    vi.stubGlobal('fetch', fetch)
    expect((await read()).bytes).toHaveLength(2)
    expect(urls(fetch)).toEqual([OTHER, NAMED])
  })

  it('does the same when its own address answers with something that is not the range', async () => {
    // A 200 would be the whole file, a 404 another bucket's answer: neither is read as heights.
    for (const status of [200, 403, 404]) {
      const fetch = vi.fn(async (input: string) => (input === OTHER ? answer(status) : partial()))
      vi.stubGlobal('fetch', fetch)
      expect((await read()).bytes).toHaveLength(2)
      expect(urls(fetch)).toEqual([OTHER, NAMED])
    }
  })

  it('reports the named address’s own failure when both fail, and asks no third time', async () => {
    const fetch = vi.fn(async (input: string) => answer(input === OTHER ? 404 : 503))
    vi.stubGlobal('fetch', fetch)
    await expect(read()).rejects.toThrow('HTTP 503')
    expect(urls(fetch)).toEqual([OTHER, NAMED])
  })

  it('does not retry an aborted read', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetch)
    await expect(read(controller.signal)).rejects.toThrow('Aborted')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('asks once when the range’s address is the named one, and for a file outside the bucket', async () => {
    const fetch = vi.fn(async () => answer(500))
    vi.stubGlobal('fetch', fetch)
    await expect(browserElevationIo.fetchRange(url, 10, 2, new AbortController().signal)).rejects.toThrow('HTTP 500')
    await expect(browserElevationIo.fetchRange('https://example.org/dem.tif', START, 2, new AbortController().signal)).rejects.toThrow('HTTP 500')
    expect(urls(fetch)).toEqual([`${url}?bytes=10-11`, `https://example.org/dem.tif?bytes=${START}-${START + 1}`])
  })
})
