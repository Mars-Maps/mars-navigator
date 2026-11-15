import { derived, official, unavailable, validateCoordinate, type Classified, type MarsCoordinate } from '../../domain'
import { bilinearCells, nearestCell } from '../elevation/demGrid'
import { bytesPerSample, type DemSource } from '../elevation/demSources'
import { layoutMismatch, readTiffLayout, TiffLayoutError, type ByteReader } from '../elevation/tiffLayout'
import { mirrorsOf, PER_HOST_CONNECTIONS, readFromMirror } from './rangeMirrors'

/**
 * Elevation adapter: heights from a USGS DEM read in
 * place by HTTP range request. Nothing is downloaded whole and nothing is
 * decoded: the file is uncompressed metres, signed 16-bit or (the Jezero
 * models) 32-bit float, one row per strip, so a pixel's bytes are
 * arithmetic from its row and column (`DemSource`). Before the first height the file's own directory is read
 * and compared with that arithmetic; a file that has changed shape gives
 * UNAVAILABLE, never a wrong number.
 *
 * Two readings. `elevationAt` is one point, nearest cell, OFFICIAL with the
 * cell's value as published. `sampleGrid` is many points, bilinear between
 * the four nearest cells, DERIVED with that method: it feeds the surface
 * view, which draws vertices 125 m apart from 200 m cells. Both say
 * UNAVAILABLE with the reason for a no-data cell, a failed or cancelled
 * read, an invalid coordinate, or a point outside a regional model's grid.
 * Never 0, never a guess.
 *
 * Rows are fetched in chunks of `chunkPx` cells and kept in a bounded
 * cache, so the next patch of ground, which overlaps the last, and repeated
 * clicks nearby are mostly served from memory.
 *
 * A file whose cells fit in `wholeFileMaxBytes` (the 9.7 MB CTX model of
 * Jezero) is read whole in one request instead, the first time any
 * cell is needed: on a fine grid nearly every sample of a profile is on its
 * own row, so per-row reads would cost one request each, and S3 does not
 * answer several ranges in one request.
 */

export interface RangeResult {
  bytes: Uint8Array
  /** The whole file's size from Content-Range, or null when the server did not say. */
  totalBytes: number | null
}

/** Injectable I/O so the adapter is tested without a network. */
export interface ElevationIo {
  /** Bytes [start, start + length) of `url`. Rejects on failure or a non-partial answer. */
  fetchRange(url: string, start: number, length: number, signal: AbortSignal): Promise<RangeResult>
}

export class DemHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'DemHttpError'
    this.status = status
  }
}

/** The total after the slash in `bytes 0-15/11384463908`, or null. */
export function contentRangeTotal(header: string | null): number | null {
  const match = header?.match(/\/(\d+)\s*$/)
  return match ? Number(match[1]) : null
}

export const browserElevationIo: ElevationIo = {
  async fetchRange(url, start, length, signal) {
    const range = `${start}-${start + length - 1}`
    // The range goes in the query as well as the header: Chrome
    // serialises concurrent requests to one URL through its HTTP cache
    // lock, which turned the six parallel reads into one at a time (30
    // reads: 9.4 s; with a URL per range, 1.5 s). S3 ignores the query
    // and answers the header. Each range is its own cache entry on an address
    // fixed per range, with the named address as the fallback.
    return readFromMirror(url, start, signal, async (address) => {
      const response = await fetch(`${address}?bytes=${range}`, { signal, headers: { Range: `bytes=${range}` } })
      // Not a partial answer: the server ignored the range. A 200 would be the whole file, so its body is cancelled.
      if (response.status !== 206) {
        await response.body?.cancel().catch(() => undefined)
        throw new DemHttpError(response.status)
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        totalBytes: contentRangeTotal(response.headers.get('Content-Range')),
      }
    })
  },
}

export interface ElevationAdapterOptions {
  /** Cells per cached chunk of a row. */
  chunkPx: number
  /** Chunks kept; the least recently needed go first. */
  maxChunks: number
  /** Range requests in flight at once; by default six per address the file answers on. */
  concurrency: number
  /** A file whose cells take at most this many bytes is read whole, once. */
  wholeFileMaxBytes: number
}

const DEFAULT_OPTIONS: ElevationAdapterOptions = {
  chunkPx: 1024,
  maxChunks: 4096,
  concurrency: PER_HOST_CONNECTIONS,
  wholeFileMaxBytes: 16_000_000,
}

/** Chunk keys are numbers, not strings: a grid sample looks up four cells per point. */
const KEY_STRIDE = 1 << 16

/** One cached chunk of a row, as stored in the file. */
type CellRow = Int16Array | Float32Array

interface Run {
  row: number
  from: number
  to: number
}

export class DemElevationAdapter {
  readonly source: DemSource
  private readonly io: ElevationIo
  private readonly options: ElevationAdapterOptions
  /** The one layout check; resolves to why heights cannot be read, or null. */
  private layoutCheck: Promise<string | null> | null = null
  private readonly chunks = new Map<number, CellRow>()
  /** The no-data value as a stored cell reads back: float32 cells are rounded to float32. */
  private readonly noDataCell: number
  /** Every cell, row-major, once a small file has been read whole. */
  private whole: CellRow | null = null
  private wholeLoad: Promise<void> | null = null

  constructor(source: DemSource, io: ElevationIo = browserElevationIo, options: Partial<ElevationAdapterOptions> = {}) {
    this.source = source
    this.io = io
    this.options = { ...DEFAULT_OPTIONS, concurrency: PER_HOST_CONNECTIONS * mirrorsOf(source.url).length, ...options }
    this.noDataCell = source.sample === 'float32' ? Math.fround(source.noData) : source.noData
    if (source.widthPx / this.options.chunkPx > KEY_STRIDE) throw new Error('Too many chunks per row for the cache key')
  }

  get id(): string {
    return this.source.id
  }

  /** Whether this file is read whole in one request rather than by rows. */
  get readsWhole(): boolean {
    return this.cellBytes <= this.options.wholeFileMaxBytes
  }

  private get cellBytes(): number {
    return this.source.widthPx * this.source.heightPx * bytesPerSample(this.source)
  }

  /** The provenance line for a nearest-cell value. */
  get pointSource(): string {
    const s = this.source
    return `${s.label}, nearest ${s.resolution.classification === 'UNAVAILABLE' ? '' : s.resolution.value + ' '}cell (${s.attribution}); ${s.datum}, uncertainty ${s.uncertainty}. ${s.caveat}`
  }

  /** The method line for a bilinear grid. */
  get gridMethod(): string {
    const s = this.source
    return `Bilinear between the four nearest ${s.resolution.classification === 'UNAVAILABLE' ? '' : s.resolution.value + ' '}cells of the ${s.label} (${s.attribution}); ${s.datum}, uncertainty ${s.uncertainty}. ${s.caveat}`
  }

  /**
   * Starts the layout check now, so the first height does not wait for it:
   * four small sequential reads, a few seconds on a home connection. Also
   * surfaces a changed file before anyone asks for a height. Never rejects.
   * With `whole`, a file read whole is also fetched once it checks out.
   */
  prepare(whole = false): Promise<string | null> {
    const check = this.verified()
    if (whole && this.readsWhole) void check.then((bad) => (bad ? undefined : this.loadWhole(new AbortController().signal).catch(() => undefined)))
    return check
  }

  async elevationAt(coordinate: MarsCoordinate, signal: AbortSignal): Promise<Classified<number>> {
    if (signal.aborted) return unavailable('Cancelled')
    const check = validateCoordinate(coordinate)
    if (!check.ok) return unavailable(`Not a valid coordinate (${check.reason})`)
    const blocked = await this.verified()
    if (signal.aborted) return unavailable('Cancelled')
    if (blocked) return unavailable(blocked)
    const at = nearestCell(this.source, coordinate.latitude, coordinate.longitudeEast)
    if (at === null) return unavailable(this.outside)
    const { row, col } = at
    try {
      await this.load(new Map([[row, new Set([this.chunkOf(col)])]]), signal)
    } catch (error) {
      return unavailable(signal.aborted ? 'Cancelled' : this.describe(error))
    }
    const value = this.cell(row, col)
    if (this.isNoData(value)) return unavailable(`No height here: the ${this.source.label} marks this cell no-data`)
    return official(value, this.pointSource)
  }

  /**
   * One nearest-cell height per (latitude, longitude °E) pair in `points`,
   * in order, in one load: what a profile along a path needs, where
   * 200 single lookups would be 200 round trips in a row. OFFICIAL with the
   * cells' published values. A no-data cell is NaN in its place, so the
   * caller can show that one sample as a gap and keep the rest, unlike
   * `sampleGrid`, whose mesh cannot have a hole. A point outside a
   * regional model's grid is NaN the same way. UNAVAILABLE as a
   * whole only when nothing could be read: a bad point, the layout check, a
   * failed or cancelled read.
   */
  async elevationsAt(points: Float64Array, signal: AbortSignal): Promise<Classified<Float32Array>> {
    if (signal.aborted) return unavailable('Cancelled')
    if (points.length % 2 !== 0) return unavailable('Points must be (latitude, longitude) pairs')
    const count = points.length / 2
    const needed = new Map<number, Set<number>>()
    // -1 marks a point outside the grid.
    const cells = new Int32Array(count * 2).fill(-1)
    for (let i = 0; i < count; i++) {
      const lat = points[i * 2]
      const lon = points[i * 2 + 1]
      if (!(lat >= -90 && lat <= 90 && lon >= 0 && lon < 360)) {
        return unavailable(`Point ${i} (${lat}, ${lon}) is not a valid coordinate`)
      }
      const at = nearestCell(this.source, lat, lon)
      if (at === null) continue
      const { row, col } = at
      cells[i * 2] = row
      cells[i * 2 + 1] = col
      const chunk = this.chunkOf(col)
      const set = needed.get(row)
      if (set) set.add(chunk)
      else needed.set(row, new Set([chunk]))
    }
    let chunkCount = 0
    for (const set of needed.values()) chunkCount += set.size
    if (!this.readsWhole && chunkCount > this.options.maxChunks) {
      return unavailable(`Too many points at once: ${chunkCount} chunks of the ${this.source.label} needed, the cache holds ${this.options.maxChunks}`)
    }
    const blocked = await this.verified()
    if (signal.aborted) return unavailable('Cancelled')
    if (blocked) return unavailable(blocked)
    try {
      await this.load(needed, signal)
    } catch (error) {
      return unavailable(signal.aborted ? 'Cancelled' : this.describe(error))
    }
    const heights = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      if (cells[i * 2] < 0) {
        heights[i] = Number.NaN
        continue
      }
      const value = this.cell(cells[i * 2], cells[i * 2 + 1])
      heights[i] = this.isNoData(value) ? Number.NaN : value
    }
    return official(heights, this.pointSource)
  }

  /**
   * One height per (latitude, longitude °E) pair in `points`, in order.
   * Matches the surface view's `SurfaceElevation.sample` so the shell can
   * pass it straight through.
   */
  async sampleGrid(points: Float64Array, signal: AbortSignal): Promise<Classified<Float32Array>> {
    if (signal.aborted) return unavailable('Cancelled')
    if (points.length % 2 !== 0) return unavailable('Points must be (latitude, longitude) pairs')
    const count = points.length / 2
    const needed = new Map<number, Set<number>>()
    const need = (row: number, chunk: number) => {
      const set = needed.get(row)
      if (set) set.add(chunk)
      else needed.set(row, new Set([chunk]))
    }
    for (let i = 0; i < count; i++) {
      const lat = points[i * 2]
      const lon = points[i * 2 + 1]
      if (!(lat >= -90 && lat <= 90 && lon >= 0 && lon < 360)) {
        return unavailable(`Point ${i} (${lat}, ${lon}) is not a valid coordinate`)
      }
      const b = bilinearCells(this.source, lat, lon)
      if (b === null) return unavailable(this.outside)
      need(b.r0, this.chunkOf(b.c0))
      need(b.r0, this.chunkOf(b.c1))
      need(b.r1, this.chunkOf(b.c0))
      need(b.r1, this.chunkOf(b.c1))
    }
    // The cache must hold every chunk this call reads at once, or the last
    // loads would evict the first before they are read.
    let chunkCount = 0
    for (const set of needed.values()) chunkCount += set.size
    if (!this.readsWhole && chunkCount > this.options.maxChunks) {
      return unavailable(`Too many points at once: ${chunkCount} chunks of the ${this.source.label} needed, the cache holds ${this.options.maxChunks}`)
    }
    const blocked = await this.verified()
    if (signal.aborted) return unavailable('Cancelled')
    if (blocked) return unavailable(blocked)
    try {
      await this.load(needed, signal)
    } catch (error) {
      return unavailable(signal.aborted ? 'Cancelled' : this.describe(error))
    }
    const heights = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const lat = points[i * 2]
      const lon = points[i * 2 + 1]
      // Every point was inside the grid in the first pass.
      const cells = bilinearCells(this.source, lat, lon)
      if (cells === null) return unavailable(this.outside)
      const { r0, r1, c0, c1, tx, ty } = cells
      const a = this.cell(r0, c0)
      const b = this.cell(r0, c1)
      const c = this.cell(r1, c0)
      const d = this.cell(r1, c1)
      if (this.isNoData(a) || this.isNoData(b) || this.isNoData(c) || this.isNoData(d)) {
        return unavailable(`No height at ${lat.toFixed(3)}°, ${lon.toFixed(3)}°E: the ${this.source.label} marks a cell there no-data`)
      }
      heights[i] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
    }
    return derived(heights, this.gridMethod)
  }

  /** Runs the layout check once. A network failure is retried on the next call; a changed file is not. */
  private verified(): Promise<string | null> {
    if (!this.layoutCheck) {
      // Its own signal: three small reads that every caller shares, so one
      // caller cancelling must not fail the others.
      const own = new AbortController().signal
      // The directory read may run past the end of a small file; a short answer is fine there.
      const read: ByteReader = (start, length, signal) => this.range(start, length, signal, false)
      this.layoutCheck = readTiffLayout(read, own)
        .then((layout) => {
          const mismatch = layoutMismatch(layout, this.source)
          if (mismatch) throw new TiffLayoutError(mismatch)
          return null
        })
        .catch((error: unknown) => {
          if (!(error instanceof TiffLayoutError)) this.layoutCheck = null
          return this.describe(error)
        })
    }
    return this.layoutCheck
  }

  private get outside(): string {
    return `Outside the ${this.source.label}: it covers its site only`
  }

  private isNoData(value: number): boolean {
    return value === this.noDataCell || Number.isNaN(value)
  }

  private describe(error: unknown): string {
    const label = this.source.label
    if (error instanceof TiffLayoutError) {
      return `The ${label} file is not the shape expected (${error.message}), so no height is read from it`
    }
    if (error instanceof DemHttpError) return `The ${label} server answered ${error.message}`
    if (error instanceof Error && error.name === 'AbortError') return 'Cancelled'
    return `The ${label} could not be read: ${error instanceof Error ? error.message : String(error)}`
  }

  /** Every read goes through here, so a file whose size changed is caught on any request. */
  private async range(start: number, length: number, signal: AbortSignal, exact = true): Promise<Uint8Array> {
    const result = await this.io.fetchRange(this.source.url, start, length, signal)
    if (result.totalBytes !== null && result.totalBytes !== this.source.fileBytes) {
      // A different file: forget its predecessor's cells along with the check.
      this.layoutCheck = null
      this.chunks.clear()
      this.whole = null
      this.wholeLoad = null
      throw new TiffLayoutError(`file size is ${result.totalBytes}, expected ${this.source.fileBytes}`)
    }
    if (exact && result.bytes.length !== length) {
      throw new Error(`short read: ${result.bytes.length} of ${length} bytes`)
    }
    return result.bytes
  }

  private chunkOf(col: number): number {
    return Math.floor(col / this.options.chunkPx)
  }

  private key(row: number, chunk: number): number {
    return row * KEY_STRIDE + chunk
  }

  private cell(row: number, col: number): number {
    if (this.whole) return this.whole[row * this.source.widthPx + col]
    const chunk = this.chunkOf(col)
    const values = this.chunks.get(this.key(row, chunk))
    if (!values) throw new Error(`Row ${row} chunk ${chunk} was not loaded`)
    return values[col - chunk * this.options.chunkPx]
  }

  /** Fetches the chunks in `needed` that are not cached, consecutive ones in one request, a few at a time. */
  private async load(needed: Map<number, Set<number>>, signal: AbortSignal): Promise<void> {
    if (this.readsWhole) return this.loadWhole(signal)
    const runs: Run[] = []
    for (const [row, set] of needed) {
      const missing: number[] = []
      for (const chunk of [...set].sort((a, b) => a - b)) {
        const key = this.key(row, chunk)
        const cached = this.chunks.get(key)
        if (cached) {
          // Re-insert: the cache evicts in insertion order, so this marks it recently needed.
          this.chunks.delete(key)
          this.chunks.set(key, cached)
        } else missing.push(chunk)
      }
      for (let i = 0; i < missing.length; ) {
        let j = i
        while (j + 1 < missing.length && missing[j + 1] === missing[j] + 1) j++
        runs.push({ row, from: missing[i], to: missing[j] })
        i = j + 1
      }
    }
    if (runs.length === 0) return
    const inner = new AbortController()
    const onAbort = () => inner.abort()
    if (signal.aborted) inner.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    let failure: unknown = null
    let next = 0
    const worker = async () => {
      while (next < runs.length && !inner.signal.aborted) {
        const run = runs[next++]
        try {
          await this.fetchRun(run, inner.signal)
        } catch (error) {
          failure ??= error
          inner.abort()
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(this.options.concurrency, runs.length) }, worker))
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    if (failure) throw failure
  }

  /**
   * Reads every cell in one request, shared by all callers: one caller
   * cancelling stops its own wait, not the read. A failed read is retried
   * on the next call.
   */
  private async loadWhole(signal: AbortSignal): Promise<void> {
    if (this.whole) return
    if (!this.wholeLoad) {
      const own = new AbortController().signal
      const { widthPx, heightPx, firstRowOffset } = this.source
      const float = this.source.sample === 'float32'
      const size = bytesPerSample(this.source)
      this.wholeLoad = this.range(firstRowOffset, this.cellBytes, own)
        .then((bytes) => {
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          const count = widthPx * heightPx
          const cells: CellRow = float ? new Float32Array(count) : new Int16Array(count)
          for (let i = 0; i < count; i++) cells[i] = float ? view.getFloat32(i * size, true) : view.getInt16(i * size, true)
          this.whole = cells
        })
        .catch((error: unknown) => {
          this.wholeLoad = null
          throw error
        })
      // Waiters get the failure below; this keeps it from going unhandled when every waiter has cancelled.
      this.wholeLoad.catch(() => undefined)
    }
    const loading = this.wholeLoad
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      loading.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  private async fetchRun(run: Run, signal: AbortSignal): Promise<void> {
    const { chunkPx, maxChunks } = this.options
    const { widthPx, firstRowOffset } = this.source
    const size = bytesPerSample(this.source)
    const float = this.source.sample === 'float32'
    const colFrom = run.from * chunkPx
    const colTo = Math.min(widthPx, (run.to + 1) * chunkPx)
    const start = firstRowOffset + run.row * widthPx * size + colFrom * size
    const bytes = await this.range(start, (colTo - colFrom) * size, signal)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let chunk = run.from; chunk <= run.to; chunk++) {
      const first = chunk * chunkPx - colFrom
      const length = Math.min(chunkPx, widthPx - chunk * chunkPx)
      const values: CellRow = float ? new Float32Array(length) : new Int16Array(length)
      for (let i = 0; i < length; i++) {
        values[i] = float ? view.getFloat32((first + i) * size, true) : view.getInt16((first + i) * size, true)
      }
      this.chunks.set(this.key(run.row, chunk), values)
      while (this.chunks.size > maxChunks) {
        const oldest = this.chunks.keys().next().value
        if (oldest === undefined) break
        this.chunks.delete(oldest)
      }
    }
  }
}
