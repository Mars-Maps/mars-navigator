import { describe, expect, it } from 'vitest'
import type { Classified } from '../../src/domain'
import { DemElevationAdapter, DemHttpError, type ElevationIo } from '../../src/data/adapters/ElevationAdapter'
import { LayeredElevation, type SourcedHeights } from '../../src/data/adapters/LayeredElevation'
import { bilinearCells, edgeDistanceM, gridCovers, nearestCell } from '../../src/data/elevation/demGrid'
import {
  ELEVATION_CHAIN,
  ELEVATION_SOURCE,
  SITE_DEM_SOURCES,
  type DemExtent,
  type DemSource,
} from '../../src/data/elevation/demSources'
import { layoutMismatch } from '../../src/data/elevation/tiffLayout'

// Test fixtures only: invented little DEM files, never shown in the app.

const R = 3_396_190
const RAD = Math.PI / 180

/** A regional extent whose west/north corner sits at (lon, lat) degrees, `cellM` metres per cell. */
const regionAt = (lon: number, lat: number, cellM: number): DemExtent => ({
  kind: 'regional',
  westM: lon * RAD * R,
  northM: lat * RAD * R,
  cellM,
  radiusM: R,
})

/** Degrees per metre on the Mars 2000 sphere. */
const DEG_PER_M = 1 / (RAD * R)

/**
 * A classic little-endian TIFF: header, directory at 8, then rows of
 * `width` cells, float32 or int16, one row per strip. Only the tags the
 * adapter's layout check reads.
 */
function tinyTiff(width: number, height: number, sample: 'float32' | 'int16', value: (r: number, c: number) => number, noData: string) {
  const size = sample === 'float32' ? 4 : 2
  const nd = new TextEncoder().encode(`${noData}\0`)
  const tags: [number, number, number, number | Uint8Array][] = [
    [256, 3, 1, width],
    [257, 3, 1, height],
    [258, 3, 1, size * 8],
    [259, 3, 1, 1],
    [273, 4, height, 0], // filled below
    [278, 3, 1, 1],
    [279, 4, height, 0],
    [339, 3, 1, sample === 'float32' ? 3 : 2],
    [42113, 2, nd.length, nd],
  ]
  const dirAt = 8
  const dirBytes = 2 + tags.length * 12 + 4
  const offsetsAt = dirAt + dirBytes
  const countsAt = offsetsAt + height * 4
  const ndAt = countsAt + height * 4
  const dataAt = ndAt + nd.length + 7
  const rowBytes = width * size
  const total = dataAt + height * rowBytes
  const buf = new ArrayBuffer(total)
  const v = new DataView(buf)
  const bytes = new Uint8Array(buf)
  bytes.set([0x49, 0x49, 0x2a, 0], 0)
  v.setUint32(4, dirAt, true)
  v.setUint16(dirAt, tags.length, true)
  tags.forEach(([tag, type, count, val], i) => {
    const at = dirAt + 2 + i * 12
    v.setUint16(at, tag, true)
    v.setUint16(at + 2, type, true)
    v.setUint32(at + 4, count, true)
    if (tag === 273) v.setUint32(at + 8, offsetsAt, true)
    else if (tag === 279) v.setUint32(at + 8, countsAt, true)
    else if (val instanceof Uint8Array) {
      bytes.set(val, ndAt)
      v.setUint32(at + 8, ndAt, true)
    } else if (type === 3) v.setUint16(at + 8, val, true)
    else v.setUint32(at + 8, val, true)
  })
  for (let r = 0; r < height; r++) {
    v.setUint32(offsetsAt + r * 4, dataAt + r * rowBytes, true)
    v.setUint32(countsAt + r * 4, rowBytes, true)
    for (let c = 0; c < width; c++) {
      if (sample === 'float32') v.setFloat32(dataAt + r * rowBytes + c * 4, value(r, c), true)
      else v.setInt16(dataAt + r * rowBytes + c * 2, value(r, c), true)
    }
  }
  return { bytes, dataAt, total }
}

function ioFor(bytes: Uint8Array, fail = false): ElevationIo & { requests: number } {
  const io = {
    requests: 0,
    fetchRange: async (_url: string, start: number, length: number) => {
      io.requests++
      if (fail) throw new DemHttpError(503)
      return { bytes: bytes.slice(start, Math.min(bytes.length, start + length)), totalBytes: bytes.length }
    },
  }
  return io
}

const signal = () => new AbortController().signal
const FLOAT_NO_DATA = '-3.40282265508890445e+38'

function sourceFor(
  id: DemSource['id'],
  file: ReturnType<typeof tinyTiff>,
  width: number,
  height: number,
  extra: Partial<DemSource>,
): DemSource {
  return {
    ...ELEVATION_SOURCE,
    id,
    label: `fixture ${id}`,
    tiff: 'classic',
    widthPx: width,
    heightPx: height,
    fileBytes: file.total,
    firstRowOffset: file.dataAt,
    ...extra,
  }
}

/**
 * Three models, as the app's chain: a 4 × 4 "1 m" site grid (heights 1000 +
 * cell, no-data in its top-left cell), a 4 × 4 "20 m" grid around it
 * (heights 500), and a global 8 × 4 grid (heights −100).
 */
function chain(
  options: { fineFails?: boolean; midFails?: boolean; fineRowByRow?: boolean; globalRowByRow?: boolean; blendM?: number } = {},
) {
  const fineFile = tinyTiff(4, 4, 'float32', (r, c) => (r === 0 && c === 0 ? -3.40282265508890445e38 : 1000 + r * 4 + c), FLOAT_NO_DATA)
  const midFile = tinyTiff(4, 4, 'float32', () => 500, FLOAT_NO_DATA)
  const globalFile = tinyTiff(8, 4, 'int16', () => -100, '-32768')
  const fine = sourceFor('jezero-hirise-1m', fineFile, 4, 4, {
    sample: 'float32',
    noData: -3.40282265508890445e38,
    extent: regionAt(77, 18.5, 1),
    cellKm: 0.001,
  })
  const mid = sourceFor('jezero-ctx-20m', midFile, 4, 4, {
    sample: 'float32',
    noData: -3.40282265508890445e38,
    extent: regionAt(77, 18.5, 20),
    cellKm: 0.02,
  })
  const global = sourceFor('hrsc-mola-blend-200m', globalFile, 8, 4, { sample: 'int16', noData: -32768, cellKm: 0.2 })
  const ios = {
    fine: ioFor(fineFile.bytes, options.fineFails),
    mid: ioFor(midFile.bytes, options.midFails),
    global: ioFor(globalFile.bytes),
  }
  const layered = new LayeredElevation([
    // The real HiRISE file is too big to read whole; `fineRowByRow` makes the fixture behave so.
    new DemElevationAdapter(fine, ios.fine, options.fineRowByRow ? { wholeFileMaxBytes: 0 } : {}),
    new DemElevationAdapter(mid, ios.mid),
    // The real global file is read by row ranges; `globalRowByRow` makes the fixture behave so.
    new DemElevationAdapter(global, ios.global, options.globalRowByRow ? { wholeFileMaxBytes: 0 } : {}),
  ], { blendM: options.blendM })
  return { layered, fine, mid, global, ios, fineFile, midFile }
}

/** The centre of cell (row, col) of a regional grid cornered at (77°E, 18.5°N). */
const centreOf = (row: number, col: number, cellM: number) => ({
  latitude: 18.5 - (row + 0.5) * cellM * DEG_PER_M,
  longitudeEast: 77 + (col + 0.5) * cellM * DEG_PER_M,
})

// The datum check's figures (DATA_SOURCES.md): each model in the chain states how far it sat from the rovers' heights.
describe("rover heights in each model's uncertainty", () => {
  it('quotes the measured differences, after the published figure, for every model the app reads', () => {
    for (const source of ELEVATION_CHAIN) {
      expect(source.uncertainty).toMatch(/against the rovers' own waypoint heights \(live feeds read 2026-11-07/)
      // Shown in the app: no tracker number a reader cannot look up.
      expect(source.uncertainty).not.toMatch(/#\d/)
    }
    expect(ELEVATION_SOURCE.uncertainty).toMatch(/^at least ±3 m/)
    expect(ELEVATION_SOURCE.uncertainty).toMatch(/Curiosity at Gale median \+1\.0 m, 95% within 23\.5 m, worst −40\.0 m/)
    expect(SITE_DEM_SOURCES['jezero-ctx-20m'].uncertainty).toMatch(/95% within 7\.2 m/)
  })

  it('says the 1 m match is agreement, not an independent check', () => {
    expect(SITE_DEM_SOURCES['jezero-hirise-1m'].uncertainty).toMatch(/85% within 0\.5 m.*agreement, not an independent check/)
  })
})

describe('regional DEM grids', () => {
  const grid = { widthPx: 4, heightPx: 4, extent: regionAt(77, 18.5, 20) }

  it('puts a point in the cell its metres say, from the outer corner', () => {
    const c = centreOf(2, 1, 20)
    expect(nearestCell(grid, c.latitude, c.longitudeEast)).toEqual({ row: 2, col: 1 })
    expect(gridCovers(grid, c.latitude, c.longitudeEast)).toBe(true)
  })

  it('has no cell for a point outside, so a site model never answers for other ground', () => {
    expect(nearestCell(grid, 18.6, 77.0001)).toBeNull()
    expect(nearestCell(grid, 18.4999, 76.9999)).toBeNull()
    expect(bilinearCells(grid, 0, 0)).toBeNull()
    expect(gridCovers(grid, 18.4999, 77 + 81 * DEG_PER_M)).toBe(false)
  })

  it('weights the four centres inside, and takes the edge cell in the outer half cell', () => {
    // 31 m in: 1.55 cells, a twentieth of the way from centre 1 to centre 2.
    const between = { latitude: 18.5 - 31 * DEG_PER_M, longitudeEast: 77 + 31 * DEG_PER_M }
    const b = bilinearCells(grid, between.latitude, between.longitudeEast)
    expect(b).toMatchObject({ r0: 1, r1: 2, c0: 1, c1: 2 })
    expect(b?.tx).toBeCloseTo(0.05)
    expect(b?.ty).toBeCloseTo(0.05)
    const corner = bilinearCells(grid, 18.5 - 2 * DEG_PER_M, 77 + 2 * DEG_PER_M)
    expect(corner).toMatchObject({ r0: 0, c0: 0, tx: 0, ty: 0 })
  })

  it('places the Jezero models where USGS says they are', () => {
    // Product pages: HiRISE 77.2229–77.584°E, 18.3068–18.6693°N.
    const hirise = SITE_DEM_SOURCES['jezero-hirise-1m']
    expect(gridCovers(hirise, 18.6692, 77.223)).toBe(true)
    expect(gridCovers(hirise, 18.307, 77.5839)).toBe(true)
    expect(gridCovers(hirise, 18.6694, 77.4)).toBe(false)
    expect(gridCovers(hirise, 18.5, 77.2228)).toBe(false)
    // Perseverance's landing site, 77.4509°E 18.4447°N, is inside both.
    expect(gridCovers(hirise, 18.4447, 77.4509)).toBe(true)
    expect(gridCovers(SITE_DEM_SOURCES['jezero-ctx-20m'], 18.4447, 77.4509)).toBe(true)
  })
})

describe('float32 DEMs', () => {
  it('checks the layout as float32: 32 bits, sample format 3', () => {
    const hirise = SITE_DEM_SOURCES['jezero-hirise-1m']
    const layout = {
      widthPx: hirise.widthPx,
      heightPx: hirise.heightPx,
      bitsPerSample: 32,
      sampleFormat: 3,
      compression: 1,
      rowsPerStrip: 1,
      firstStripOffset: hirise.firstRowOffset,
      lastStripOffset: hirise.firstRowOffset + (hirise.heightPx - 1) * hirise.widthPx * 4,
      firstStripBytes: hirise.widthPx * 4,
      // GDAL's tag, parsed as the layout reader parses it.
      noData: Number.parseFloat(FLOAT_NO_DATA),
    }
    expect(layoutMismatch(layout, hirise)).toBeNull()
    expect(layoutMismatch({ ...layout, sampleFormat: 2, bitsPerSample: 16 }, hirise)).toMatch(/bits per sample is 16, expected 32/)
  })

  it('reads float heights, and the float no-data cell as no height', async () => {
    const { fine, ios } = chain()
    const adapter = new DemElevationAdapter(fine, ios.fine)
    const ok = await adapter.elevationAt(centreOf(1, 2, 1), signal())
    expect(ok).toMatchObject({ classification: 'OFFICIAL', value: 1006 })
    const gap = await adapter.elevationAt(centreOf(0, 0, 1), signal())
    expect(gap.classification).toBe('UNAVAILABLE')
    const outside = await adapter.elevationAt({ latitude: 0, longitudeEast: 10 }, signal())
    expect(outside).toMatchObject({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/Outside the fixture/) })
  })
})

describe('LayeredElevation', () => {
  const pairs = (...cs: { latitude: number; longitudeEast: number }[]) =>
    new Float64Array(cs.flatMap((c) => [c.latitude, c.longitudeEast]))

  it('takes each height from the finest model with data there, and says which', async () => {
    const { layered } = chain()
    const read = await layered.elevationsAt(
      pairs(centreOf(1, 2, 1), centreOf(0, 0, 1), centreOf(3, 3, 20), { latitude: -40, longitudeEast: 200 }),
      signal(),
    )
    expect(read.classification).toBe('OFFICIAL')
    if (read.classification !== 'OFFICIAL') return
    const { heights, sourceIndex, sources } = read.value
    // In the fine grid with data; in its no-data cell → the 20 m model; in the 20 m model only; outside both → global.
    expect([...heights]).toEqual([1006, 500, 500, -100])
    expect([...sourceIndex]).toEqual([0, 1, 1, 2])
    expect(sources[sourceIndex[0]].source).toMatch(/fixture jezero-hirise-1m/)
    expect(sources[sourceIndex[0]]).toMatchObject({ cellKm: 0.001, site: true })
    expect(sources[sourceIndex[3]].source).toMatch(/fixture hrsc-mola-blend-200m/)
    expect(sources[sourceIndex[3]]).toMatchObject({ cellKm: 0.2, site: false })
  })

  it('falls back to the next model when a site file cannot be read', async () => {
    const { layered, ios } = chain({ fineFails: true })
    const read = await layered.elevationsAt(pairs(centreOf(1, 2, 1)), signal())
    expect(read).toMatchObject({ classification: 'OFFICIAL' })
    if (read.classification === 'OFFICIAL') expect(read.value.heights[0]).toBe(500)
    expect(ios.fine.requests).toBeGreaterThan(0)
  })

  it('never asks a site model about ground outside it', async () => {
    const { layered, ios } = chain()
    await layered.elevationsAt(pairs({ latitude: -40, longitudeEast: 200 }), signal())
    expect(ios.fine.requests).toBe(0)
    expect(ios.mid.requests).toBe(0)
  })

  it('samples a profile at the coarsest cell the path needs', () => {
    const { layered } = chain()
    expect(layered.cellKmAlong([centreOf(0, 0, 1), centreOf(3, 3, 1)])).toBe(0.001)
    expect(layered.cellKmAlong([centreOf(0, 0, 1), centreOf(3, 3, 20)])).toBe(0.02)
    expect(layered.cellKmAlong([centreOf(0, 0, 1), { latitude: 0, longitudeEast: 10 }])).toBe(0.2)
  })

  it('names the grid a search runs on: the coarsest model it reads along the path, never one read by rows', () => {
    const { layered } = chain({ fineRowByRow: true, globalRowByRow: true })
    expect(layered.searchGridAlong([centreOf(1, 1, 1), centreOf(2, 2, 1)])).toEqual({ cellKm: 0.02, readsWhole: true })
    expect(layered.searchGridAlong([centreOf(1, 1, 1), { latitude: 0, longitudeEast: 10 }])).toEqual({ cellKm: 0.2, readsWhole: false })
    // A site model small enough to read whole is searched at its own cell.
    expect(chain().layered.searchGridAlong([centreOf(1, 1, 1), centreOf(2, 2, 1)])).toEqual({ cellKm: 0.001, readsWhole: true })
  })

  it('reads a search from every model but one read by rows, the global DEM answering outside the site', async () => {
    const { layered, ios } = chain({ fineRowByRow: true, globalRowByRow: true })
    const read = await layered.searchElevationsAt(pairs(centreOf(1, 2, 1), { latitude: -40, longitudeEast: 200 }), signal())
    expect(read.classification).toBe('OFFICIAL')
    if (read.classification !== 'OFFICIAL') return
    const { heights, sourceIndex, sources } = read.value
    expect([...heights]).toEqual([500, -100])
    expect(sources[sourceIndex[0]]).toMatchObject({ cellKm: 0.02, site: true })
    expect(sources[sourceIndex[1]]).toMatchObject({ cellKm: 0.2, site: false })
    expect(ios.fine.requests).toBe(0)
    // At the global cell the site models are left out, so a search there never steps between models.
    const midRequests = ios.mid.requests
    const coarse = await layered.searchElevationsAt(pairs(centreOf(1, 2, 1)), signal(), 0.2)
    expect(coarse.classification).toBe('OFFICIAL')
    if (coarse.classification === 'OFFICIAL') expect([...coarse.value.heights]).toEqual([-100])
    expect(ios.mid.requests).toBe(midRequests)
  })

  it('draws a surface patch that fits inside one model from that model alone, the finest', async () => {
    const { layered } = chain()
    // Clear of the fine grid's no-data cell (0, 0) and its neighbours' weights.
    const inFine = await layered.sampleGrid(pairs(centreOf(2, 2, 1), centreOf(2.3, 2.3, 1)), signal())
    expect(inFine).toMatchObject({ classification: 'DERIVED' })
    if (inFine.classification === 'DERIVED') expect(inFine.method).toMatch(/fixture jezero-hirise-1m/)
    // One point past the fine grid: the whole patch comes from the 20 m model.
    const across = await layered.sampleGrid(pairs(centreOf(2, 2, 1), centreOf(3, 3, 20)), signal())
    if (across.classification === 'DERIVED') expect(across.method).toMatch(/fixture jezero-ctx-20m/)
    else throw new Error('expected DERIVED')
    // A patch over the fine grid's no-data cell: the 20 m model, not a hole.
    const gap = await layered.sampleGrid(pairs(centreOf(0, 0, 1)), signal())
    if (gap.classification === 'DERIVED') expect(gap.method).toMatch(/fixture jezero-ctx-20m/)
    else throw new Error('expected DERIVED')
  })
})

describe('surface patches across a site model\'s edge', () => {
  const pairs = (...cs: { latitude: number; longitudeEast: number }[]) =>
    new Float64Array(cs.flatMap((c) => [c.latitude, c.longitudeEast]))
  const far = { latitude: -40, longitudeEast: 200 }
  // The 20 m fixture is 80 m across: a 40 m blend reaches its middle.
  const blendM = 40

  it('blends the site model in by its distance from the edge, and keeps the global DEM outside', async () => {
    const { layered } = chain({ fineRowByRow: true, blendM })
    // (2, 2) is the grid's middle corner, 40 m from every edge; cell (2, 2)'s centre is 30 m from the nearest.
    const read = await layered.sampleGrid(pairs(centreOf(1.5, 1.5, 20), centreOf(2, 2, 20), far), signal())
    expect(read.classification).toBe('DERIVED')
    if (read.classification !== 'DERIVED') return
    // Full weight at 40 m; smoothstep(0.75) = 0.84375 at 30 m: 0.84375 × 500 + 0.15625 × −100.
    expect([...read.value]).toEqual([500, 406.25, -100])
    expect(read.method).toMatch(/fixture jezero-ctx-20m.*Blended .* 0\.04 km .*Elsewhere: .*fixture hrsc-mola-blend-200m/s)
  })

  it('has no step at the edge: a point in its outer half cell is almost the global height', async () => {
    const { layered } = chain({ fineRowByRow: true, blendM })
    const read = await layered.sampleGrid(pairs(centreOf(-0.4, 1.5, 20), far), signal())
    if (read.classification !== 'DERIVED') throw new Error('expected DERIVED')
    // 2 m in from the north edge: weight smoothstep(0.05) ≈ 0.007.
    const w = 0.05 * 0.05 * (3 - 2 * 0.05)
    expect(read.value[0]).toBeCloseTo(w * 500 + (1 - w) * -100, 3)
  })

  it('leaves out a site model read by rows, and asks it nothing', async () => {
    const { layered, ios } = chain({ fineRowByRow: true, blendM })
    await layered.sampleGrid(pairs(centreOf(2, 2, 1), far), signal())
    expect(ios.fine.requests).toBe(0)
  })

  it('tries the next site model when the first has a no-data cell under the patch', async () => {
    const { layered } = chain({ blendM })
    // The 1 m fixture's no-data cell is (0, 0): it cannot answer, so the 20 m model is blended in.
    const read = await layered.sampleGrid(pairs(centreOf(0, 0, 1), far), signal())
    if (read.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(read.method).toMatch(/fixture jezero-ctx-20m/)
    expect(read.method).not.toMatch(/fixture jezero-hirise-1m/)
  })

  it('draws the global DEM alone, as before, when no site model can be read', async () => {
    const { layered } = chain({ fineFails: true, midFails: true, blendM })
    const read = await layered.sampleGrid(pairs(centreOf(1.5, 1.5, 20), far), signal())
    if (read.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect([...read.value]).toEqual([-100, -100])
    expect(read.method).not.toMatch(/Blended/)
  })

  it('reports a cancel during the site read as cancelled, after the global read has finished', async () => {
    const { layered, ios } = chain({ fineRowByRow: true, blendM })
    const controller = new AbortController()
    // Cancel from inside the 20 m model's first request: the global DEM has answered by then.
    const fetchRange = ios.mid.fetchRange
    ios.mid.fetchRange = async (...args) => {
      controller.abort()
      return fetchRange(...args)
    }
    const read = await layered.sampleGrid(pairs(centreOf(1.5, 1.5, 20), far), controller.signal)
    expect(ios.global.requests).toBeGreaterThan(0)
    expect(read).toEqual({ classification: 'UNAVAILABLE', reason: 'Cancelled' })
  })

  it('names the global DEM as the model the site is blended into', async () => {
    const { layered } = chain({ fineRowByRow: true, blendM })
    const read = await layered.sampleGrid(pairs(centreOf(1.5, 1.5, 20), far), signal())
    if (read.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(read.method).toMatch(/Blended into the fixture hrsc-mola-blend-200m over the last/)
  })
})

describe('edgeDistanceM', () => {
  // The 4 × 4 "20 m" fixture grid: 80 m a side, cornered at (77°E, 18.5°N).
  const grid = { widthPx: 4, heightPx: 4, extent: regionAt(77, 18.5, 20) }
  const at = (row: number, col: number) => centreOf(row - 0.5, col - 0.5, 20)

  it('is the distance to the nearest edge, in metres, from every side', () => {
    expect(edgeDistanceM(grid, at(2, 2).latitude, at(2, 2).longitudeEast)).toBeCloseTo(40, 6)
    expect(edgeDistanceM(grid, at(0.5, 2).latitude, at(0.5, 2).longitudeEast)).toBeCloseTo(10, 6)
    expect(edgeDistanceM(grid, at(3.5, 2).latitude, at(3.5, 2).longitudeEast)).toBeCloseTo(10, 6)
    expect(edgeDistanceM(grid, at(2, 0.25).latitude, at(2, 0.25).longitudeEast)).toBeCloseTo(5, 6)
    expect(edgeDistanceM(grid, at(2, 3.75).latitude, at(2, 3.75).longitudeEast)).toBeCloseTo(5, 6)
  })

  it('is null outside the grid and for a global grid', () => {
    expect(edgeDistanceM(grid, at(2, -0.5).latitude, at(2, -0.5).longitudeEast)).toBeNull()
    expect(edgeDistanceM({ widthPx: 8, heightPx: 4 }, 0, 0)).toBeNull()
  })
})

describe('the elevation chain', () => {
  it('is HiRISE 1 m, then CTX 20 m, then the global DEM, all above the MOLA areoid', () => {
    expect(ELEVATION_CHAIN.map((s) => s.id)).toEqual(['jezero-hirise-1m', 'jezero-ctx-20m', ELEVATION_SOURCE.id])
    for (const s of ELEVATION_CHAIN) {
      expect(s.datum).toMatch(/areoid/)
      expect(s.url).toMatch(/^https:\/\/asc-pds-services\.s3/)
      expect(s.licence).toMatch(/cite authors/i)
      expect(s.resolution.classification).toBe('OFFICIAL')
    }
    for (const s of Object.values(SITE_DEM_SOURCES)) {
      expect(s.sample).toBe('float32')
      expect(s.extent.kind).toBe('regional')
      expect(s.attribution).toMatch(/Fergason/)
    }
  })
})

describe('whole-file reads', () => {
  const rows = (...cs: { latitude: number; longitudeEast: number }[]) =>
    new Float64Array(cs.flatMap((c) => [c.latitude, c.longitudeEast]))
  const points = rows(centreOf(0, 1, 20), centreOf(1, 2, 20), centreOf(2, 3, 20), centreOf(3, 0, 20))

  it('reads a small model in one request, with the same heights as row by row', async () => {
    const { mid, midFile } = chain()
    const io = ioFor(midFile.bytes)
    const whole = new DemElevationAdapter(mid, io)
    expect(whole.readsWhole).toBe(true)
    await whole.prepare()
    const before = io.requests
    const a = await whole.elevationsAt(points, signal())
    expect(io.requests - before).toBe(1)
    const byRow = await new DemElevationAdapter(mid, ioFor(midFile.bytes), { wholeFileMaxBytes: 0 }).elevationsAt(points, signal())
    expect(a).toEqual(byRow)
  })

  it('shares one read between callers, and one caller cancelling does not stop it', async () => {
    const { mid, midFile } = chain()
    const io = ioFor(midFile.bytes)
    const adapter = new DemElevationAdapter(mid, io)
    await adapter.prepare()
    const before = io.requests
    const cancelled = new AbortController()
    const first = adapter.elevationsAt(points, cancelled.signal)
    cancelled.abort()
    const [a, b] = await Promise.all([first, adapter.elevationsAt(points, signal())])
    expect(a).toEqual({ classification: 'UNAVAILABLE', reason: 'Cancelled' })
    expect(b.classification).toBe('OFFICIAL')
    expect(io.requests - before).toBe(1)
  })
})

describe('a failed whole-file read', () => {
  it('reaches its waiters and does not go unhandled when the only waiter has cancelled', async () => {
    const { mid, midFile } = chain()
    const controller = new AbortController()
    let failData = false
    const io: ElevationIo = {
      fetchRange: async (_url, start, length) => {
        if (failData) {
          // The caller gives up while the shared read is in flight, then the read fails.
          controller.abort()
          await new Promise((resolve) => setTimeout(resolve, 0))
          throw new DemHttpError(503)
        }
        return { bytes: midFile.bytes.slice(start, start + length), totalBytes: midFile.bytes.length }
      },
    }
    const adapter = new DemElevationAdapter(mid, io)
    await adapter.prepare()
    failData = true
    expect(await adapter.elevationAt(centreOf(1, 1, 20), controller.signal)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Cancelled',
    })
    // Let the shared read fail with no one waiting: vitest fails the run on an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const again = await adapter.elevationAt(centreOf(1, 1, 20), signal())
    expect(again).toMatchObject({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/503/) })
  })
})

describe('prefetching a model read whole', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
  const points = new Float64Array([centreOf(1, 1, 20).latitude, centreOf(1, 1, 20).longitudeEast])

  it('fetches the whole file once after the layout check, so the first height needs no request', async () => {
    const { mid, midFile } = chain()
    const plain = ioFor(midFile.bytes)
    await new DemElevationAdapter(mid, plain).prepare()
    const io = ioFor(midFile.bytes)
    const adapter = new DemElevationAdapter(mid, io)
    expect(await adapter.prepare(true)).toBeNull()
    await settle()
    expect(io.requests - plain.requests).toBe(1)
    expect((await adapter.elevationsAt(points, signal())).classification).toBe('OFFICIAL')
    expect(io.requests - plain.requests).toBe(1)
  })

  it('fetches nothing more for a model read by rows, nor without the flag', async () => {
    const { mid, midFile } = chain()
    // The layout check alone, by rows and with nothing fetched up front.
    const checkOnly = ioFor(midFile.bytes)
    await new DemElevationAdapter(mid, checkOnly, { wholeFileMaxBytes: 0 }).prepare()
    const byRows = ioFor(midFile.bytes)
    await new DemElevationAdapter(mid, byRows, { wholeFileMaxBytes: 0 }).prepare(true)
    const plain = ioFor(midFile.bytes)
    await new DemElevationAdapter(mid, plain).prepare()
    await settle()
    expect(checkOnly.requests).toBeGreaterThan(0)
    expect(byRows.requests).toBe(checkOnly.requests)
    expect(plain.requests).toBe(checkOnly.requests)
  })

  it('reads nothing whole when the layout check fails', async () => {
    const { mid, midFile } = chain()
    const sizes: number[] = []
    const io: ElevationIo = {
      fetchRange: async (_url, _start, length) => {
        sizes.push(length)
        throw new DemHttpError(503)
      },
    }
    expect(await new DemElevationAdapter(mid, io).prepare(true)).toMatch(/503/)
    await settle()
    // Only the check's small reads: none of the whole file's cell bytes.
    const cellBytes = midFile.total - midFile.dataAt
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.every((n) => n < cellBytes)).toBe(true)
  })

  it('swallows a failed fetch, and the first height asks again', async () => {
    const { mid, midFile } = chain()
    let failData = false
    let requests = 0
    const io: ElevationIo = {
      fetchRange: async (_url, start, length) => {
        requests++
        if (failData) throw new DemHttpError(503)
        return { bytes: midFile.bytes.slice(start, start + length), totalBytes: midFile.bytes.length }
      },
    }
    const adapter = new DemElevationAdapter(mid, io)
    await adapter.prepare()
    failData = true
    const tried = requests
    await adapter.prepare(true)
    // vitest fails the run on an unhandled rejection.
    await settle()
    expect(requests - tried).toBe(1)
    failData = false
    const before = requests
    expect((await adapter.elevationsAt(points, signal())).classification).toBe('OFFICIAL')
    expect(requests - before).toBe(1)
  })

  it('through the chain, fetches only the model read whole', async () => {
    const { layered, ios } = chain({ fineRowByRow: true })
    layered.prepare(true)
    await settle()
    const after = { fine: ios.fine.requests, mid: ios.mid.requests, global: ios.global.requests }
    const plain = chain({ fineRowByRow: true })
    plain.layered.prepare()
    await settle()
    expect(after.mid - plain.ios.mid.requests).toBe(1)
    expect(after.fine).toBe(plain.ios.fine.requests)
    // The 8 × 4 fixture global grid is small enough to be read whole too; the real one is not.
    expect(after.global - plain.ios.global.requests).toBe(1)
  })
})

describe('progressive heights', () => {
  const pairs = (...cs: { latitude: number; longitudeEast: number }[]) =>
    new Float64Array(cs.flatMap((c) => [c.latitude, c.longitudeEast]))

  it('answers first from the fast models, then from the slow 1 m model, each height naming its model', async () => {
    const { layered } = chain({ fineRowByRow: true })
    const firsts: Classified<SourcedHeights>[] = []
    const last = await layered.elevationsAt(pairs(centreOf(1, 2, 1), centreOf(3, 3, 20)), signal(), (f) => firsts.push(f))
    expect(firsts).toHaveLength(1)
    const first = firsts[0]
    if (first.classification !== 'OFFICIAL' || last.classification !== 'OFFICIAL') throw new Error('expected OFFICIAL')
    expect([...first.value.heights]).toEqual([500, 500])
    expect([...first.value.sourceIndex]).toEqual([1, 1])
    expect([...last.value.heights]).toEqual([1006, 500])
    expect([...last.value.sourceIndex]).toEqual([0, 1])
  })

  it('gives no first answer where no slow model covers the points', async () => {
    const { layered } = chain({ fineRowByRow: true })
    const firsts: unknown[] = []
    await layered.elevationsAt(pairs({ latitude: -40, longitudeEast: 200 }, centreOf(3, 3, 20)), signal(), (f) => firsts.push(f))
    expect(firsts).toHaveLength(0)
  })

  it('gives no first answer once cancelled', async () => {
    const { layered } = chain({ fineRowByRow: true })
    const controller = new AbortController()
    const firsts: unknown[] = []
    const read = layered.elevationsAt(pairs(centreOf(1, 2, 1)), controller.signal, (f) => firsts.push(f))
    controller.abort()
    expect(await read).toEqual({ classification: 'UNAVAILABLE', reason: 'Cancelled' })
    expect(firsts).toHaveLength(0)
  })
})
