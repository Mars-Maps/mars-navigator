// Node's types, to read the committed grids from disk. Once referenced they
// reach the whole test project, but the app project (tsconfig.app.json),
// which checks src without tests, still has none, so src cannot lean on them.
/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cellAt,
  loadTesThermalGrids,
  parseThermalGrid,
  TES_GRID_FILES,
  TES_GRIDS_READING_REASON,
  tesThermalGrids,
  tesThermalGridsUnavailable,
  ThermalGridError,
  type BytesIo,
  type ThermalGrid,
} from '../../src/data/adapters/ThermalGridAdapter'
import { JEZERO } from '../../src/data/sites/sites'
import { isAvailable, type Classified, type MarsCoordinate } from '../../src/domain'

// Test fixtures only: invented 4 × 2 grids at 1 px/deg, not TES values.
function bytesOf(values: number[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(values.length * 2))
  values.forEach((v, i) => view.setUint16(i * 2, v, true))
  return view.buffer
}

const sidecar = (over: Record<string, unknown> = {}) => ({
  grid: 'fixture',
  quantity: 'thermalInertia',
  scale: 1,
  validRange: [5, 5000],
  widthPx: 4,
  heightPx: 2,
  pxPerDeg: 1,
  westDeg: 10,
  northDeg: 20,
  noData: 0,
  citation: 'Fixture citation',
  resampling: 'fixture resampling',
  noDataRule: 'fixture rule',
  ...over,
})

// Row 0 (20–19°N): 100 200 0 400; row 1 (19–18°N): 500 600 700 800.
const CELLS = [100, 200, 0, 400, 500, 600, 700, 800]

const valueOf = (v: Classified<number>) => (isAvailable(v) ? v.value : null)

describe('parseThermalGrid', () => {
  it('reads a well-formed grid', () => {
    const grid = parseThermalGrid(sidecar(), bytesOf(CELLS), 'thermalInertia')
    expect(grid.widthPx).toBe(4)
    expect(Array.from(grid.cells)).toEqual(CELLS)
  })

  it('rejects a grid whose bytes do not match its stated shape', () => {
    expect(() => parseThermalGrid(sidecar(), bytesOf(CELLS.slice(0, 6)), 'thermalInertia')).toThrow(ThermalGridError)
    expect(() => parseThermalGrid(sidecar({ widthPx: 5 }), bytesOf(CELLS), 'thermalInertia')).toThrow(/expected 5 × 2 × 2/)
  })

  it('rejects a cell outside the valid range, never clamping it', () => {
    expect(() => parseThermalGrid(sidecar(), bytesOf([...CELLS.slice(0, 7), 6000]), 'thermalInertia')).toThrow(/cell 7 holds 6000/)
    expect(() => parseThermalGrid(sidecar(), bytesOf([4, ...CELLS.slice(1)]), 'thermalInertia')).toThrow(/outside 5–5000/)
  })

  it('rejects the wrong quantity, a missing citation and a grid past the globe', () => {
    expect(() => parseThermalGrid(sidecar(), bytesOf(CELLS), 'albedo')).toThrow(/expected albedo/)
    expect(() => parseThermalGrid(sidecar({ citation: '' }), bytesOf(CELLS), 'thermalInertia')).toThrow(/citation/)
    expect(() => parseThermalGrid(sidecar({ westDeg: 178 }), bytesOf(CELLS), 'thermalInertia')).toThrow(/past the globe/)
    expect(() => parseThermalGrid('nope', bytesOf(CELLS), 'thermalInertia')).toThrow(/not a JSON object/)
  })
})

describe('the TES lookups', () => {
  const site: ThermalGrid = parseThermalGrid(sidecar({ grid: 'site' }), bytesOf(CELLS), 'thermalInertia')
  const global: ThermalGrid = parseThermalGrid(
    sidecar({ grid: 'global', widthPx: 2, heightPx: 1, pxPerDeg: 1, westDeg: -180, northDeg: 90, scale: 1 }),
    // West half 300, east half 900: a site lookup that wrongly fell through would read one of them.
    bytesOf([300, 900]),
    'thermalInertia',
  )
  // A global grid of 180° × 180° cells is not what the build writes; it only stands in for "elsewhere".
  const wide = { ...global, pxPerDeg: 1 / 180 }
  const albedo = parseThermalGrid(
    sidecar({ quantity: 'albedo', scale: 0.0001, validRange: [0, 1] }),
    bytesOf([1290, 1290, 1290, 1290, 1290, 1290, 1290, 1290]),
    'albedo',
  )
  const grids = tesThermalGrids({ site, global: wide }, { site: albedo, global: { ...wide, quantity: 'albedo' } })

  it('returns the nearest cell, OFFICIAL with the citation and the method', () => {
    const v = grids.thermalInertia({ latitude: 18.5, longitudeEast: 11.9 })
    expect(valueOf(v)).toBe(600)
    expect(v.classification).toBe('OFFICIAL')
    expect(v.classification === 'OFFICIAL' && v.source).toMatch(/Fixture citation.*centred 18\.5°N, 11\.5°E, nearest cell with no interpolation/)
    expect(valueOf(grids.thermalInertia({ latitude: 19.99, longitudeEast: 13.99 }))).toBe(400)
    expect(valueOf(grids.albedo({ latitude: 19, longitudeEast: 12 }))).toBe(0.129)
  })

  it('gives UNAVAILABLE for a no-data cell, never 0 and never the coarser grid', () => {
    // The global cell under this point holds 900, so falling through would answer OFFICIAL 900.
    const v = grids.thermalInertia({ latitude: 19.5, longitudeEast: 12.5 })
    expect(v.classification).toBe('UNAVAILABLE')
    expect(v.classification === 'UNAVAILABLE' && v.reason).toMatch(/No thermal inertia.*fixture rule/)
  })

  it('falls back to the global grid only outside the site grid, and refuses the polar caps', () => {
    const v = grids.thermalInertia({ latitude: 0, longitudeEast: 200 })
    expect(valueOf(v)).toBe(300)
    expect(v.classification === 'OFFICIAL' && v.source).toMatch(/grid global/)
    expect(grids.thermalInertia({ latitude: 87.5, longitudeEast: 12 })).toEqual({
      classification: 'UNAVAILABLE',
      reason: expect.stringMatching(/87°S–87°N/),
    })
  })

  it('gives UNAVAILABLE, never OFFICIAL NaN, for a NaN latitude or longitude', () => {
    for (const p of [{ latitude: NaN, longitudeEast: 12 }, { latitude: 19, longitudeEast: NaN }]) {
      expect(cellAt(site, p)).toBeNull()
      for (const v of [grids.thermalInertia(p), grids.albedo(p)]) {
        expect(v).toEqual({ classification: 'UNAVAILABLE', reason: 'The point is not on the TES grids' })
      }
    }
  })

  it('reads 0–360°E longitudes on a −180 to 180 grid', () => {
    const west = parseThermalGrid(sidecar({ westDeg: -10 }), bytesOf(CELLS), 'thermalInertia')
    expect(cellAt(west, { latitude: 19.5, longitudeEast: 351.5 })).toEqual({ row: 0, col: 1 })
    expect(cellAt(west, { latitude: 19.5, longitudeEast: 6 })).toBeNull()
  })

  it('says why while reading or after a failure', async () => {
    expect(tesThermalGridsUnavailable().properties(JEZERO.centre).albedo).toEqual({ classification: 'UNAVAILABLE', reason: TES_GRIDS_READING_REASON })
    const broken: BytesIo = { fetchBytes: () => Promise.reject(new Error('HTTP 404')) }
    const failed = await loadTesThermalGrids(new AbortController().signal, broken)
    const v = failed.thermalInertia(JEZERO.centre)
    expect(v.classification === 'UNAVAILABLE' && v.reason).toBe('The TES thermal inertia grid failed to load: HTTP 404')
  })

  it('names the grid, not its URL, when a sidecar is not JSON', async () => {
    const garbled: BytesIo = { fetchBytes: async () => new TextEncoder().encode('<html>').buffer as ArrayBuffer }
    const v = (await loadTesThermalGrids(new AbortController().signal, garbled)).albedo(JEZERO.centre)
    expect(v.classification === 'UNAVAILABLE' && v.reason).toMatch(/^The TES albedo grid failed to load: the (Jezero|global) grid's sidecar is not JSON$/)
  })
})

describe('the committed TES grids', () => {
  // The committed files on disk, served to the loader by name.
  const onDisk: BytesIo = {
    fetchBytes: async (url) => {
      const name = url.split('/').pop()?.split('?')[0] ?? ''
      const b = readFileSync(`src/data/thermal/${name}`)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
  }
  const JEZERO_FLOOR: MarsCoordinate = { latitude: 18.4447, longitudeEast: 77.4508 }
  const ELSEWHERE: MarsCoordinate = { latitude: -14.5, longitudeEast: 175.5 }

  it('lists every committed grid', () => {
    expect(Object.values(TES_GRID_FILES).flatMap((q) => [q.site, q.global])).toHaveLength(4)
  })

  // Git sees the smallest grid as text (no zero byte), and the repo's
  // `text=auto eol=lf` would rewrite a CR LF pair in it: the checksum the
  // build wrote catches that, or any other change to a committed grid.
  it('matches the checksum its sidecar records', () => {
    for (const name of ['tes-albedo-global', 'tes-albedo-jezero', 'tes-thermal-inertia-day-global', 'tes-thermal-inertia-day-jezero']) {
      const sidecar = JSON.parse(readFileSync(`src/data/thermal/${name}.json`, 'utf8')) as { binMd5: string }
      expect(createHash('md5').update(readFileSync(`src/data/thermal/${name}.bin`)).digest('hex'), name).toBe(sidecar.binMd5)
    }
  })

  it('returns the Jezero floor in the published ranges, from the full-resolution cut', async () => {
    const grids = await loadTesThermalGrids(new AbortController().signal, onDisk)
    // The PDS map's cell at the site centre. An earlier stand-in's 246 was read
    // from ASU's WMS copy, which sits 0.25° east of the PDS file (5 cells):
    // ASU's 77.50–77.60°E holds the PDS values at 77.25–77.35°E.
    expect(valueOf(grids.thermalInertia(JEZERO.centre))).toBe(283)
    // The USGS mosaic's cell there (MD5 as published; orientation checked on
    // Syrtis Major 0.100 and Arabia 0.280). The stand-in's 0.129 is not it.
    expect(valueOf(grids.albedo(JEZERO.centre))).toBe(0.1681)
    for (const p of [JEZERO.centre, JEZERO_FLOOR]) {
      const { thermalInertia, albedo } = grids.properties(p)
      expect(thermalInertia.classification).toBe('OFFICIAL')
      expect(valueOf(thermalInertia)).toBeGreaterThanOrEqual(21)
      expect(valueOf(thermalInertia)).toBeLessThanOrEqual(4333)
      expect(valueOf(albedo)).toBeGreaterThanOrEqual(0.09)
      expect(valueOf(albedo)).toBeLessThanOrEqual(0.32)
      expect(thermalInertia.classification === 'OFFICIAL' && thermalInertia.source).toMatch(/20 px\/deg cell/)
    }
  })

  it('reads the Jezero cut on the map box west and north edges, not the global grid', async () => {
    const grids = await loadTesThermalGrids(new AbortController().signal, onDisk)
    for (const p of [{ latitude: 18.2, longitudeEast: 76.8 }, { latitude: 18.7, longitudeEast: 77.3 }]) {
      const ti = grids.thermalInertia(p)
      expect(ti.classification === 'OFFICIAL' && ti.source, `${p.latitude}°N ${p.longitudeEast}°E`).toMatch(/20 px\/deg cell/)
    }
  })

  it('reads the global grids away from the site and refuses the caps', async () => {
    const grids = await loadTesThermalGrids(new AbortController().signal, onDisk)
    const ti = grids.thermalInertia(ELSEWHERE)
    expect(ti.classification === 'OFFICIAL' && ti.source).toMatch(/2 px\/deg cell/)
    expect(grids.albedo({ latitude: -88, longitudeEast: 0 }).classification).toBe('UNAVAILABLE')
  })
})
