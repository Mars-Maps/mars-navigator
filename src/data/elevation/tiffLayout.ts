import { bytesPerSample, type DemSource } from './demSources'

/**
 * Reads enough of a GeoTIFF's directory to know whether the pixel-offset
 * arithmetic in `DemSource` is safe to use on it. The adapter runs
 * this once per source before the first height. It is not a TIFF decoder:
 * only the handful of tags that fix the byte layout are read, and the
 * arrays that list every strip are sampled at their first and last entries
 * rather than fetched whole (the 200 m file's is 427 KB).
 *
 * Classic TIFF (`II*`) and BigTIFF (`II+`) little-endian are handled; the
 * two global USGS DEMs are one of each, the Jezero models classic.
 * Anything else is an error, not a guess.
 */

export interface TiffLayout {
  widthPx: number
  heightPx: number
  bitsPerSample: number
  /** TIFF SampleFormat: 1 unsigned, 2 signed, 3 float. */
  sampleFormat: number
  /** TIFF Compression: 1 is none. */
  compression: number
  rowsPerStrip: number
  firstStripOffset: number
  lastStripOffset: number
  firstStripBytes: number
  /** GDAL's no-data tag, parsed, or null when the file has none. */
  noData: number | null
}

/** Bytes [start, start + length) of the file. Rejects on failure. */
export type ByteReader = (start: number, length: number, signal: AbortSignal) => Promise<Uint8Array>

export class TiffLayoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TiffLayoutError'
  }
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  sampleFormat: 339,
  gdalNoData: 42113,
} as const

/** Bytes per element of a TIFF field type we may meet. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 16: 8 }

interface Entry {
  type: number
  count: number
  /** The value's bytes when they fit in the entry, else null. */
  inline: Uint8Array | null
  /** Where the value's bytes are when they do not fit. */
  offset: number
}

/** Up to this many bytes of directory are read in one go: 100 BigTIFF entries. */
const DIRECTORY_BYTES = 2048

function readNumber(bytes: Uint8Array, at: number, type: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (type) {
    case 3:
      return view.getUint16(at, true)
    case 4:
      return view.getUint32(at, true)
    case 16: {
      const big = view.getBigUint64(at, true)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new TiffLayoutError('An offset is past 2^53')
      return Number(big)
    }
    default:
      throw new TiffLayoutError(`Unexpected TIFF field type ${type}`)
  }
}

function parseDirectory(bytes: Uint8Array, big: boolean): Map<number, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = big ? Number(view.getBigUint64(0, true)) : view.getUint16(0, true)
  const entrySize = big ? 20 : 12
  const countSize = big ? 8 : 2
  const inlineMax = big ? 8 : 4
  if (countSize + count * entrySize > bytes.length) {
    throw new TiffLayoutError(`The TIFF directory has ${count} entries, more than expected`)
  }
  const entries = new Map<number, Entry>()
  for (let i = 0; i < count; i++) {
    const at = countSize + i * entrySize
    const tag = view.getUint16(at, true)
    const type = view.getUint16(at + 2, true)
    const num = big ? Number(view.getBigUint64(at + 4, true)) : view.getUint32(at + 4, true)
    const valueAt = at + (big ? 12 : 8)
    const size = (TYPE_SIZE[type] ?? 0) * num
    const fits = size > 0 && size <= inlineMax
    entries.set(tag, {
      type,
      count: num,
      inline: fits ? bytes.subarray(valueAt, valueAt + size) : null,
      offset: fits ? 0 : readNumber(bytes, valueAt, big ? 16 : 4),
    })
  }
  return entries
}

export async function readTiffLayout(read: ByteReader, signal: AbortSignal): Promise<TiffLayout> {
  const head = await read(0, 16, signal)
  if (head.length < 16) throw new TiffLayoutError('The file is shorter than a TIFF header')
  if (head[0] !== 0x49 || head[1] !== 0x49) {
    throw new TiffLayoutError('Big-endian TIFF: the adapter reads little-endian files only')
  }
  let big: boolean
  if (head[2] === 0x2a && head[3] === 0) big = false
  else if (head[2] === 0x2b && head[3] === 0 && readNumber(head, 4, 3) === 8) big = true
  else throw new TiffLayoutError('Not a TIFF file')
  const directoryAt = big ? readNumber(head, 8, 16) : readNumber(head, 4, 4)

  const directory = await read(directoryAt, DIRECTORY_BYTES, signal)
  const entries = parseDirectory(directory, big)
  // Out-of-line values that landed inside the directory read are served from it.
  const bytesAt = async (at: number, length: number): Promise<Uint8Array> => {
    const local = at - directoryAt
    if (local >= 0 && local + length <= directory.length) return directory.subarray(local, local + length)
    return read(at, length, signal)
  }
  const entry = (tag: number, name: string): Entry => {
    const e = entries.get(tag)
    if (!e) throw new TiffLayoutError(`The TIFF has no ${name} tag`)
    return e
  }
  const scalar = (tag: number, name: string): number => {
    const e = entry(tag, name)
    if (!e.inline || e.count !== 1) throw new TiffLayoutError(`${name} is not a single value`)
    return readNumber(e.inline, 0, e.type)
  }
  // Element `index` of an array tag, read from the file unless it is inline.
  const element = async (tag: number, name: string, index: number): Promise<number> => {
    const e = entry(tag, name)
    if (index >= e.count) throw new TiffLayoutError(`${name} has ${e.count} entries, not ${index + 1}`)
    const size = TYPE_SIZE[e.type]
    if (!size) throw new TiffLayoutError(`${name} has an unexpected field type ${e.type}`)
    if (e.inline) return readNumber(e.inline, index * size, e.type)
    return readNumber(await bytesAt(e.offset + index * size, size), 0, e.type)
  }

  const heightPx = scalar(TAG.height, 'ImageLength')
  const strips = entry(TAG.stripOffsets, 'StripOffsets').count
  let noData: number | null = null
  const nd = entries.get(TAG.gdalNoData)
  if (nd) {
    const text = nd.inline ?? (await bytesAt(nd.offset, nd.count))
    const parsed = Number.parseFloat(new TextDecoder().decode(text).replace(/\0.*$/, ''))
    noData = Number.isFinite(parsed) ? parsed : null
  }
  return {
    widthPx: scalar(TAG.width, 'ImageWidth'),
    heightPx,
    bitsPerSample: scalar(TAG.bitsPerSample, 'BitsPerSample'),
    sampleFormat: entries.has(TAG.sampleFormat) ? scalar(TAG.sampleFormat, 'SampleFormat') : 1,
    compression: scalar(TAG.compression, 'Compression'),
    rowsPerStrip: scalar(TAG.rowsPerStrip, 'RowsPerStrip'),
    firstStripOffset: await element(TAG.stripOffsets, 'StripOffsets', 0),
    lastStripOffset: await element(TAG.stripOffsets, 'StripOffsets', strips - 1),
    firstStripBytes: await element(TAG.stripByteCounts, 'StripByteCounts', 0),
    noData,
  }
}

/**
 * Why `source`'s pixel arithmetic cannot be used on a file with `layout`,
 * or null when it can. The first difference found is named, so a changed
 * file is reported as what changed, not as "wrong".
 */
export function layoutMismatch(layout: TiffLayout, source: DemSource): string | null {
  const rowBytes = source.widthPx * bytesPerSample(source)
  const float = source.sample === 'float32'
  const checks: [string, number, number][] = [
    ['width', layout.widthPx, source.widthPx],
    ['height', layout.heightPx, source.heightPx],
    ['bits per sample', layout.bitsPerSample, float ? 32 : 16],
    // TIFF SampleFormat: 2 signed integer, 3 IEEE float.
    ['sample format', layout.sampleFormat, float ? 3 : 2],
    ['compression', layout.compression, 1],
    ['rows per strip', layout.rowsPerStrip, 1],
    ['first row offset', layout.firstStripOffset, source.firstRowOffset],
    ['row bytes', layout.firstStripBytes, rowBytes],
    ['last row offset', layout.lastStripOffset, source.firstRowOffset + (source.heightPx - 1) * rowBytes],
    ['no-data value', layout.noData ?? Number.NaN, source.noData],
  ]
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) return `${name} is ${actual}, expected ${expected}`
  }
  return null
}
