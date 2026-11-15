import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserElevationIo,
  contentRangeTotal,
  DemElevationAdapter,
  DemHttpError,
  type ElevationAdapterOptions,
  type ElevationIo,
} from '../../src/data/adapters/ElevationAdapter'
import { ASC_PDS_S3 } from '../../src/data/adapters/rangeMirrors'
import { bilinearCells, nearestCell, toLongitude180 } from '../../src/data/elevation/demGrid'
import { DEM_SOURCES, ELEVATION_SOURCE, type DemSource } from '../../src/data/elevation/demSources'
import { layoutMismatch, readTiffLayout, type ByteReader } from '../../src/data/elevation/tiffLayout'

/**
 * A sparse file: segments at offsets, zero elsewhere. Reads past the end are
 * short, as a server's would be.
 */
class VirtualFile {
  private readonly segments: { at: number; bytes: Uint8Array }[] = []
  readonly requests: { start: number; length: number }[] = []
  readonly size: number
  constructor(size: number) {
    this.size = size
  }
  put(at: number, bytes: Uint8Array) {
    this.segments.push({ at, bytes })
    return this
  }
  read(start: number, length: number): Uint8Array {
    this.requests.push({ start, length })
    const end = Math.min(this.size, start + length)
    const out = new Uint8Array(Math.max(0, end - start))
    for (const { at, bytes } of this.segments) {
      const from = Math.max(start, at)
      const to = Math.min(end, at + bytes.length)
      if (from < to) out.set(bytes.subarray(from - at, to - at), from - start)
    }
    return out
  }
  io(options: { status?: number; totalBytes?: number | null; failAfter?: number } = {}): ElevationIo {
    return {
      fetchRange: async (_url, start, length, signal) => {
        if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        if (options.failAfter !== undefined && this.requests.length >= options.failAfter) throw new TypeError('Failed to fetch')
        if (options.status !== undefined && options.status !== 206) throw new DemHttpError(options.status)
        return { bytes: this.read(start, length), totalBytes: options.totalBytes === undefined ? this.size : options.totalBytes }
      },
    }
  }
}

/**
 * These tests cover the per-row reads, so whole-file reading, which
 * every file this small would get, is switched off; it has its own tests in
 * jezeroElevation.test.ts.
 */
const rowAdapter = (source: DemSource, io: ElevationIo, options: Partial<ElevationAdapterOptions> = {}) =>
  new DemElevationAdapter(source, io, { wholeFileMaxBytes: 0, ...options })

const u16 = (v: number) => new Uint8Array(new Uint16Array([v]).buffer)
const u64 = (v: number) => new Uint8Array(new BigUint64Array([BigInt(v)]).buffer)
const i16 = (v: number) => new Uint8Array(new Int16Array([v]).buffer)

/**
 * A little BigTIFF with the USGS layout: header, directory at 16, strip
 * arrays after it, then `height` rows of `width` signed 16-bit cells.
 * `value(row, col)` fills the cells.
 */
function tinyDem(width: number, height: number, value: (row: number, col: number) => number) {
  const DATA_AT = 512
  const rowBytes = width * 2
  const entries: [tag: number, type: number, count: number, value: Uint8Array | number][] = [
    [256, 4, 1, width],
    [257, 3, 1, height],
    [258, 3, 1, 16],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 16, height, 256],
    [277, 3, 1, 1],
    [278, 3, 1, 1],
    [279, 16, height, 256 + height * 8],
    [339, 3, 1, 2],
    [42113, 2, 7, new TextEncoder().encode('-32768\0')],
  ]
  const file = new VirtualFile(DATA_AT + height * rowBytes)
  file.put(0, new Uint8Array([0x49, 0x49, 0x2b, 0, 8, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0]))
  const dir = new Uint8Array(8 + entries.length * 20 + 8)
  dir.set(u64(entries.length), 0)
  entries.forEach(([tag, type, count, v], i) => {
    const at = 8 + i * 20
    dir.set(u16(tag), at)
    dir.set(u16(type), at + 2)
    dir.set(u64(count), at + 4)
    if (v instanceof Uint8Array) dir.set(v, at + 12)
    else if (type === 3) dir.set(u16(v), at + 12)
    else if (type === 4) dir.set(new Uint8Array(new Uint32Array([v]).buffer), at + 12)
    else dir.set(u64(v), at + 12)
  })
  file.put(16, dir)
  const offsets = new Uint8Array(height * 8)
  const counts = new Uint8Array(height * 8)
  for (let r = 0; r < height; r++) {
    offsets.set(u64(DATA_AT + r * rowBytes), r * 8)
    counts.set(u64(rowBytes), r * 8)
  }
  file.put(256, offsets).put(256 + height * 8, counts)
  const data = new Uint8Array(height * rowBytes)
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) data.set(i16(value(r, c)), (r * width + c) * 2)
  file.put(DATA_AT, data)
  const source: DemSource = {
    ...ELEVATION_SOURCE,
    id: 'mola-463m',
    label: 'tiny DEM',
    widthPx: width,
    heightPx: height,
    fileBytes: file.size,
    firstRowOffset: DATA_AT,
  }
  return { file, source }
}

// 8 columns of 45°, 4 rows of 45°. Cell (r, c) holds 100 r + c; (3, 7) is no-data.
const tiny = () => tinyDem(8, 4, (r, c) => (r === 3 && c === 7 ? -32768 : 100 * r + c))
/** The tiny file's layout check: header and directory; the strip arrays fall inside the directory read. */
const LAYOUT_READS = 2

describe('demGrid', () => {
  const grid = { widthPx: 8, heightPx: 4 }

  it('converts the project longitude to the file\'s', () => {
    expect(toLongitude180(0)).toBe(0)
    expect(toLongitude180(179.9)).toBeCloseTo(179.9)
    expect(toLongitude180(180)).toBe(-180)
    expect(toLongitude180(350)).toBe(-10)
  })

  it('finds the nearest cell, wrapping the seam and clamping the poles', () => {
    expect(nearestCell(grid, 89, 0.1)).toEqual({ row: 0, col: 4 })
    expect(nearestCell(grid, 90, 180)).toEqual({ row: 0, col: 0 })
    expect(nearestCell(grid, -90, 359.99)).toEqual({ row: 3, col: 3 })
    expect(nearestCell(grid, -90, 179.99)).toEqual({ row: 3, col: 7 })
    expect(nearestCell(grid, 0, 180)).toEqual({ row: 2, col: 0 })
  })

  it('weights the four cell centres around a point', () => {
    // Centre of cell (1, 2): 67.5°W, 22.5°N.
    const centre = bilinearCells(grid, 22.5, 360 - 67.5)
    expect(centre).toMatchObject({ r0: 1, c0: 2 })
    expect(centre?.tx).toBeCloseTo(0)
    expect(centre?.ty).toBeCloseTo(0)
    // Midway between columns 7 and 0 across the seam, on row 1's centre.
    const seam = bilinearCells(grid, 22.5, 180)
    expect(seam).toMatchObject({ r0: 1, r1: 2, c0: 7, c1: 0 })
    expect(seam?.tx).toBeCloseTo(0.5)
    // At the pole both rows are the edge row.
    expect(bilinearCells(grid, 90, 10)).toMatchObject({ r0: 0, r1: 1, ty: 0 })
    expect(bilinearCells(grid, -90, 10)).toMatchObject({ r0: 3, r1: 3, ty: 0 })
  })
})

describe('tiffLayout', () => {
  it('reads the real 200 m file\'s header and finds the expected layout', async () => {
    const source = DEM_SOURCES['hrsc-mola-blend-200m']
    const file = new VirtualFile(source.fileBytes)
    file.put(0, Uint8Array.from(atob('SUkrAAgAAAAQAAAAAAAAABEAAAAAAAAAAAEEAAEAAAAAAAAAxqABAAAAAAABAQMAAQAAAAAAAABj0AAAAAAAAAIBAwABAAAAAAAAABAAAAAAAAAAAwEDAAEAAAAAAAAAAQAAAAAAAAAGAQMAAQAAAAAAAAABAAAAAAAAABEBEABj0AAAAAAAAIyEBgAAAAAAFQEDAAEAAAAAAAAAAQAAAAAAAAAWAQMAAQAAAAAAAAABAAAAAAAAABcBEABj0AAAAAAAAHQBAAAAAAAAHAEDAAEAAAAAAAAAAgAAAAAAAABTAQMAAQAAAAAAAAACAAAAAAAAAA6DDAADAAAAAAAAAKQHDQAAAAAAgoQMAAYAAAAAAAAAvAcNAAAAAACvhwMANAAAAAAAAADsBw0AAAAAALCHDAAGAAAAAAAAAFQIDQAAAAAAsYcCAHwAAAAAAAAAhAgNAAAAAACBpAIABwAAAAAAAAAtMzI3NjgAAAAAAAAAAAAAjEEDAAAAAACMQQMAAAAAAIxBAwAAAAAAjEEDAAAAAACMQQMAAAAAAIxBAwAAAAAAjEEDAAAAAACMQQMAAAAAAIxBAwAAAAAAjEEDAAAAAACMQQMAAAAAAIxBAwAAAAAAjEEDAAAAAACMQQMAAAAAAIxBAwAAAAAAjEEDAAAAAACMQQMAAAAAAIxBAwA='), (ch) => ch.charCodeAt(0)))
    // The strip arrays live past the 512 bytes kept; the two entries the check reads are put back.
    file.put(427148, u64(854272)).put(427148 + 53346 * 8, u64(11384250520))
    const read: ByteReader = async (start, length) => file.read(start, length)
    const layout = await readTiffLayout(read, new AbortController().signal)
    expect(layout).toEqual({
      widthPx: 106694,
      heightPx: 53347,
      bitsPerSample: 16,
      sampleFormat: 2,
      compression: 1,
      rowsPerStrip: 1,
      firstStripOffset: 854272,
      lastStripOffset: 11384250520,
      firstStripBytes: 213388,
      noData: -32768,
    })
    expect(layoutMismatch(layout, source)).toBeNull()
    // Header, directory, and the first and last strip offsets; the byte counts sit inside the directory read.
    expect(file.requests.length).toBe(4)
  })

  it('names the first difference from the expected layout', async () => {
    const { file, source } = tiny()
    const read: ByteReader = async (start, length) => file.read(start, length)
    const layout = await readTiffLayout(read, new AbortController().signal)
    expect(layoutMismatch(layout, source)).toBeNull()
    expect(layoutMismatch(layout, { ...source, widthPx: 9 })).toBe('width is 8, expected 9')
    expect(layoutMismatch(layout, { ...source, firstRowOffset: 500 })).toBe('first row offset is 512, expected 500')
    expect(layoutMismatch({ ...layout, compression: 5 }, source)).toBe('compression is 5, expected 1')
    expect(layoutMismatch({ ...layout, noData: null }, source)).toMatch(/no-data value is NaN/)
  })

  it('refuses what it cannot read', async () => {
    const signal = new AbortController().signal
    const bytes = (b: number[]) => async () => new Uint8Array(b)
    await expect(readTiffLayout(bytes([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]), signal)).rejects.toThrow(/Big-endian/)
    await expect(readTiffLayout(bytes([0x49, 0x49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), signal)).rejects.toThrow(/Not a TIFF/)
    await expect(readTiffLayout(bytes([0x49, 0x49]), signal)).rejects.toThrow(/shorter/)
  })
})

describe('contentRangeTotal', () => {
  it('reads the total after the slash', () => {
    expect(contentRangeTotal('bytes 0-15/11384463908')).toBe(11384463908)
    expect(contentRangeTotal('bytes */2')).toBe(2)
    expect(contentRangeTotal(null)).toBeNull()
    expect(contentRangeTotal('bytes 0-15/*')).toBeNull()
  })
})

describe('browserElevationIo', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('cancels the body of a non-partial answer instead of streaming the file', async () => {
    const cancel = vi.fn(async () => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, body: { cancel }, headers: new Headers() })))
    await expect(browserElevationIo.fetchRange('u', 0, 2, new AbortController().signal)).rejects.toBeInstanceOf(DemHttpError)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('asks for the range in the header and in the query, so Chrome caches each range on its own', async () => {
    const fetch = vi.fn(async () => ({
      status: 206,
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      headers: new Headers({ 'Content-Range': 'bytes 10-11/100' }),
    }))
    vi.stubGlobal('fetch', fetch)
    const r = await browserElevationIo.fetchRange('https://h/f.tif', 10, 2, new AbortController().signal)
    expect(fetch).toHaveBeenCalledWith('https://h/f.tif?bytes=10-11', expect.objectContaining({ headers: { Range: 'bytes=10-11' } }))
    expect(Array.from(r.bytes)).toEqual([1, 2])
    expect(r.totalBytes).toBe(100)
  })
})

describe('DemElevationAdapter.elevationAt', () => {
  const signal = () => new AbortController().signal

  it('returns the nearest cell as OFFICIAL with the product named', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 4 })
    // Cell (1, 2): 90°W to 45°W, 45°N to 0°N.
    const h = await adapter.elevationAt({ latitude: 22.5, longitudeEast: 300 }, signal())
    expect(h).toMatchObject({ classification: 'OFFICIAL', value: 102 })
    if (h.classification === 'OFFICIAL') expect(h.source).toMatch(/^tiny DEM, nearest 200 m\/px cell/)
    // The layout check, then one chunk of 4 cells from row 1.
    expect(file.requests.length).toBe(LAYOUT_READS + 1)
    expect(file.requests[LAYOUT_READS]).toEqual({ start: 512 + 1 * 16 + 0, length: 8 })
  })

  it('prepare runs the layout check once, ahead of the first height', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 4 })
    expect(await adapter.prepare()).toBeNull()
    expect(file.requests.length).toBe(LAYOUT_READS)
    await adapter.elevationAt({ latitude: 22.5, longitudeEast: 300 }, signal())
    expect(file.requests.length).toBe(LAYOUT_READS + 1)
    expect(await rowAdapter({ ...source, widthPx: 9 }, file.io()).prepare()).toMatch(/width is 8, expected 9/)
  })

  it('serves a second point in the same chunk from the cache', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 4 })
    await adapter.elevationAt({ latitude: 22.5, longitudeEast: 300 }, signal())
    const h = await adapter.elevationAt({ latitude: 22.5, longitudeEast: 345 }, signal())
    expect(h).toMatchObject({ value: 103 })
    expect(file.requests.length).toBe(LAYOUT_READS + 1)
  })

  it('says UNAVAILABLE for a no-data cell, never 0', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io())
    const h = await adapter.elevationAt({ latitude: -80, longitudeEast: 170 }, signal())
    expect(h).toMatchObject({ classification: 'UNAVAILABLE' })
    if (h.classification === 'UNAVAILABLE') expect(h.reason).toMatch(/no-data/)
  })

  it('rejects an invalid coordinate without a request', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io())
    const h = await adapter.elevationAt({ latitude: 91, longitudeEast: 10 }, signal())
    expect(h).toMatchObject({ classification: 'UNAVAILABLE', reason: 'Not a valid coordinate (latitude-range)' })
    expect(file.requests.length).toBe(0)
  })

  it('reads nothing when already cancelled, and reports a cancel mid-way', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io())
    const aborted = new AbortController()
    aborted.abort()
    expect(await adapter.elevationAt({ latitude: 0, longitudeEast: 0 }, aborted.signal)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Cancelled',
    })
    expect(file.requests.length).toBe(0)
    const controller = new AbortController()
    const slow: ElevationIo = {
      fetchRange: async (url, start, length, s) => {
        controller.abort()
        return file.io().fetchRange(url, start, length, s)
      },
    }
    const h = await rowAdapter(source, slow).elevationAt({ latitude: 0, longitudeEast: 0 }, controller.signal)
    expect(h).toEqual({ classification: 'UNAVAILABLE', reason: 'Cancelled' })
  })

  it('refuses a file whose shape differs, and does not read heights from it', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter({ ...source, firstRowOffset: 500 }, file.io())
    const h = await adapter.elevationAt({ latitude: 0, longitudeEast: 0 }, signal())
    expect(h).toMatchObject({ classification: 'UNAVAILABLE' })
    if (h.classification === 'UNAVAILABLE') expect(h.reason).toMatch(/not the shape expected \(first row offset is 512, expected 500\)/)
    const before = file.requests.length
    await adapter.elevationAt({ latitude: 0, longitudeEast: 0 }, signal())
    // A changed file is not re-checked on every call.
    expect(file.requests.length).toBe(before)
  })

  it('refuses a file whose size differs', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io({ totalBytes: file.size + 1 }))
    const h = await adapter.elevationAt({ latitude: 0, longitudeEast: 0 }, signal())
    if (h.classification === 'UNAVAILABLE') expect(h.reason).toMatch(/file size is \d+, expected \d+/)
    else throw new Error('expected UNAVAILABLE')
  })

  it('forgets cached cells when the file size changes', async () => {
    const { file, source } = tiny()
    const options = { totalBytes: file.size as number | null }
    const adapter = rowAdapter(source, file.io(options), { chunkPx: 1 })
    const first = { latitude: 67.5, longitudeEast: 180 + 22.5 } // row 0, column 0
    expect((await adapter.elevationAt(first, signal())).classification).toBe('OFFICIAL')
    const cached = file.requests.length
    expect((await adapter.elevationAt(first, signal())).classification).toBe('OFFICIAL')
    expect(file.requests.length).toBe(cached)
    options.totalBytes = file.size + 1
    expect((await adapter.elevationAt({ latitude: 0, longitudeEast: 0 }, signal())).classification).toBe('UNAVAILABLE')
    options.totalBytes = file.size
    // The first cell is read again: its cached value may have come from another file.
    await adapter.elevationAt(first, signal())
    expect(file.requests.length).toBeGreaterThan(cached + 1)
  })

  it('reports an HTTP answer and a network failure, and retries the check next time', async () => {
    const { file, source } = tiny()
    const http = await rowAdapter(source, file.io({ status: 403 })).elevationAt({ latitude: 0, longitudeEast: 0 }, signal())
    expect(http).toEqual({ classification: 'UNAVAILABLE', reason: 'The tiny DEM server answered HTTP 403' })
    const flaky = new VirtualFile(file.size)
    let calls = 0
    const io: ElevationIo = {
      fetchRange: async (url, start, length, s) => {
        calls++
        if (calls === 1) throw new TypeError('Failed to fetch')
        return file.io().fetchRange(url, start, length, s)
      },
    }
    const adapter = rowAdapter(source, io)
    const first = await adapter.elevationAt({ latitude: 0, longitudeEast: 0 }, signal())
    expect(first).toEqual({ classification: 'UNAVAILABLE', reason: 'The tiny DEM could not be read: Failed to fetch' })
    const second = await adapter.elevationAt({ latitude: 22.5, longitudeEast: 300 }, signal())
    expect(second).toMatchObject({ classification: 'OFFICIAL', value: 102 })
    expect(flaky.requests.length).toBe(0)
  })
})

describe('DemElevationAdapter.elevationsAt', () => {
  const signal = () => new AbortController().signal

  it('returns the nearest cells as OFFICIAL in one load, NaN where a cell is no-data', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 4 })
    // (1, 2) = 102 and (1, 3) = 103 share a chunk; (3, 7) is no-data; (0, 4) = 4.
    const h = await adapter.elevationsAt(new Float64Array([22.5, 300, 22.5, 345, -80, 170, 67.5, 22.5]), signal())
    expect(h.classification).toBe('OFFICIAL')
    if (h.classification !== 'OFFICIAL') return
    expect(Array.from(h.value)).toEqual([102, 103, Number.NaN, 4])
    expect(h.source).toMatch(/^tiny DEM, nearest 200 m\/px cell/)
    // Three chunks on three rows: three requests after the layout check, and none repeated.
    expect(file.requests.length).toBe(LAYOUT_READS + 3)
    await adapter.elevationsAt(new Float64Array([22.5, 300]), signal())
    expect(file.requests.length).toBe(LAYOUT_READS + 3)
  })

  it('rejects a bad point before any request, and reads nothing when already cancelled', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io())
    const bad = await adapter.elevationsAt(new Float64Array([22.5, 360]), signal())
    expect(bad).toMatchObject({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/Point 0/) })
    const controller = new AbortController()
    controller.abort()
    expect(await adapter.elevationsAt(new Float64Array([22.5, 300]), controller.signal)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Cancelled',
    })
    expect(file.requests.length).toBe(0)
  })

  it('is UNAVAILABLE as a whole with the server\'s answer when the read fails', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io({ status: 503 }))
    const h = await adapter.elevationsAt(new Float64Array([22.5, 300]), signal())
    expect(h.classification).toBe('UNAVAILABLE')
    if (h.classification === 'UNAVAILABLE') expect(h.reason).toMatch(/503/)
  })
})

describe('DemElevationAdapter.sampleGrid', () => {
  const signal = () => new AbortController().signal

  it('interpolates between cell centres and returns DERIVED with the method', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 4 })
    const points = new Float64Array([
      22.5, 360 - 67.5, // centre of (1, 2): 102
      22.5, 360 - 45, // between (1, 2) and (1, 3): 102.5
      0, 360 - 67.5, // between rows 1 and 2 at column 2: 152
      22.5, 180, // across the seam between (1, 7) and (1, 0): 103.5
    ])
    const h = await adapter.sampleGrid(points, signal())
    expect(h.classification).toBe('DERIVED')
    if (h.classification !== 'DERIVED') return
    expect(Array.from(h.value)).toEqual([102, 102.5, 152, 103.5])
    expect(h.method).toMatch(/^Bilinear between the four nearest 200 m\/px cells of the tiny DEM/)
    expect(h.method).toMatch(/uncertainty at least ±3 m/)
  })

  it('fetches each row\'s run of chunks once and reuses them', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 2 })
    // Four points whose corner cells span columns 1–4 of rows 1 and 2.
    const points = new Float64Array([22.5, 360 - 112.5, 22.5, 360 - 22.5, 0, 360 - 112.5, 0, 360 - 22.5])
    await adapter.sampleGrid(points, signal())
    const dataReads = file.requests.slice(LAYOUT_READS)
    // Rows 1 and 2, chunks 0–2 each (columns 0–5), one request per row.
    expect(dataReads).toEqual([
      { start: 512 + 16, length: 12 },
      { start: 512 + 32, length: 12 },
    ])
    await adapter.sampleGrid(points, signal())
    expect(file.requests.length).toBe(LAYOUT_READS + 2)
  })

  it('splits a seam-straddling row into two runs', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 2 })
    const h = await adapter.sampleGrid(new Float64Array([22.5, 180]), signal())
    expect(h.classification).toBe('DERIVED')
    const dataReads = file.requests.slice(LAYOUT_READS).sort((a, b) => a.start - b.start)
    expect(dataReads).toEqual([
      { start: 512 + 16, length: 4 },
      { start: 512 + 16 + 12, length: 4 },
      { start: 512 + 32, length: 4 },
      { start: 512 + 32 + 12, length: 4 },
    ])
  })

  it('is UNAVAILABLE as a whole when any corner cell is no-data', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io())
    const h = await adapter.sampleGrid(new Float64Array([0, 0, -67.5, 157.5]), signal())
    expect(h.classification).toBe('UNAVAILABLE')
    if (h.classification === 'UNAVAILABLE') expect(h.reason).toMatch(/No height at -67.500°, 157.500°E/)
  })

  it('rejects malformed input before any request', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io())
    expect(await adapter.sampleGrid(new Float64Array([1, 2, 3]), signal())).toMatchObject({ classification: 'UNAVAILABLE' })
    expect(await adapter.sampleGrid(new Float64Array([0, 360]), signal())).toMatchObject({
      reason: 'Point 0 (0, 360) is not a valid coordinate',
    })
    expect(await adapter.sampleGrid(new Float64Array([Number.NaN, 0]), signal())).toMatchObject({ classification: 'UNAVAILABLE' })
    expect(file.requests.length).toBe(0)
  })

  it('returns Cancelled when aborted during the reads', async () => {
    const { file, source } = tiny()
    const controller = new AbortController()
    let reads = 0
    const io: ElevationIo = {
      fetchRange: async (url, start, length, s) => {
        // The first data read, after the layout check.
        if (++reads === LAYOUT_READS + 1) controller.abort()
        return file.io().fetchRange(url, start, length, s)
      },
    }
    const adapter = rowAdapter(source, io, { chunkPx: 2, concurrency: 1 })
    const points = new Float64Array([22.5, 360 - 112.5, 0, 360 - 22.5])
    expect(await adapter.sampleGrid(points, controller.signal)).toEqual({ classification: 'UNAVAILABLE', reason: 'Cancelled' })
  })

  it('keeps six reads in flight per address: thirty for a file in the USGS bucket, six for any other', async () => {
    const maxInFlight = async (url: string) => {
      // 16 rows is as tall as the fixture's layout allows (its strip tables end at the data).
      const { file, source } = tinyDem(64, 16, (r, c) => r + c)
      let inFlight = 0
      let max = 0
      let reads = 0
      const io: ElevationIo = {
        fetchRange: async (u, start, length, s) => {
          // The layout check reads one at a time; count the data reads.
          const data = ++reads > LAYOUT_READS
          if (data) max = Math.max(max, ++inFlight)
          await new Promise((resolve) => setTimeout(resolve, 0))
          if (data) inFlight--
          return file.io().fetchRange(u, start, length, s)
        },
      }
      const adapter = rowAdapter({ ...source, url }, io, { chunkPx: 1 })
      // Points 8 columns apart on every row: their chunks are not consecutive,
      // so each is its own read, far more than thirty in one load.
      const points: number[] = []
      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 64; c += 8) points.push(90 - (r + 0.5) * (180 / 16), (c + 0.5) * (360 / 64))
      }
      const got = await adapter.sampleGrid(new Float64Array(points), signal())
      expect(got.classification === 'UNAVAILABLE' ? got.reason : 'read').toBe('read')
      return max
    }
    expect(await maxInFlight(`${ASC_PDS_S3}fixture/tiny.tif`)).toBe(30)
    expect(await maxInFlight('https://example.org/tiny.tif')).toBe(6)
  })

  it('is UNAVAILABLE, not a rejection, when one call needs more chunks than the cache holds', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 1, maxChunks: 2 })
    const h = await adapter.sampleGrid(new Float64Array([22.5, 360 - 67.5]), signal()) // 4 chunks
    if (h.classification === 'UNAVAILABLE') expect(h.reason).toMatch(/Too many points at once: 4 chunks/)
    else throw new Error('expected UNAVAILABLE')
    expect(file.requests.length).toBe(0)
  })

  it('evicts the least recently needed chunks past the cap', async () => {
    const { file, source } = tiny()
    const adapter = rowAdapter(source, file.io(), { chunkPx: 1, maxChunks: 4 })
    await adapter.sampleGrid(new Float64Array([22.5, 360 - 67.5]), signal()) // 4 chunks
    const after = file.requests.length
    await adapter.sampleGrid(new Float64Array([22.5, 360 - 67.5]), signal())
    expect(file.requests.length).toBe(after)
    await adapter.sampleGrid(new Float64Array([-67.5, 10]), signal()) // 4 more, evicting the first
    await adapter.sampleGrid(new Float64Array([22.5, 360 - 67.5]), signal())
    // Two chunks were evicted and come back as one run.
    expect(file.requests.length).toBe(after + 2)
  })
})

describe('DEM_SOURCES', () => {
  it('describes both products with licence, attribution, datum and a caveat', () => {
    for (const s of Object.values(DEM_SOURCES)) {
      expect(s.url).toMatch(/^https:\/\/asc-pds-services\.s3/)
      expect(s.licence.length).toBeGreaterThan(0)
      expect(s.attribution.length).toBeGreaterThan(0)
      expect(s.datum).toMatch(/areoid/)
      expect(s.uncertainty).toMatch(/±3 m/)
      expect(s.caveat).toMatch(/interpolation/)
      expect(s.resolution.classification).toBe('OFFICIAL')
      expect(s.cellKm).toBeGreaterThan(0)
      expect(s.noData).toBe(-32768)
    }
  })

  it('uses the 200 m blend', () => {
    expect(ELEVATION_SOURCE.id).toBe('hrsc-mola-blend-200m')
    expect(ELEVATION_SOURCE.licence).toMatch(/CC BY-SA/)
  })
})
