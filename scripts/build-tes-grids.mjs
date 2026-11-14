#!/usr/bin/env node
/**
 * Builds the committed TES thermal inertia and albedo grids that the
 * surface temperature model runs on.
 *
 * Sources, both public domain (cite the authors):
 *   - Thermal inertia: Putzig & Mellon 2007, PDS Geosciences volume
 *     MGST_9001 (MGS-M-TES-5-TIMAP-V1.0), the dayside map
 *     GLOBAL_TI_DAY_2007.IMG and its interpolation mask
 *     GLOBAL_TI_MSK_DAY_2007.IMG: 7200 × 3600, 20 px/deg, simple
 *     cylindrical, planetocentric, 180° domain, MSB 16-bit integers in
 *     J m⁻² K⁻¹ s⁻¹ᐟ², 0 where nothing was derived; mask 0 where the
 *     authors infilled the cell by interpolation. The dayside map, since
 *     the model was fitted on it; the nightside map is not built.
 *   - Albedo: Christensen et al. 2001, USGS
 *     Mars_MGS_TES_Albedo_mosaic_global_7410m.tif: 2880 × 1440, 8 px/deg,
 *     same projection, uncompressed little-endian 32-bit floats.
 *
 * Out, under src/data/thermal/, four grids, each a `.bin` of little-endian
 * uint16 cells (rows north to south, columns west to east, 0 = no data)
 * with a `.json` sidecar: source URL, citation, the original's MD5, the
 * resampling, the encoding and the date.
 *   - global at 2 px/deg (720 × 360): each output cell is the ONE source
 *     cell holding its centre. Nothing is averaged, so every stored number
 *     is a value of the official map.
 *   - the Jezero map box (76.8–77.8°E, 17.7–18.7°N) at the source's own
 *     resolution: every source cell that overlaps the box.
 * No data: a source 0 or special pixel, an interpolated cell (mask 0), or
 * a cell centred poleward of 87°, the band the authors infilled to (the
 * issue's rule; the maps do hold values there). Albedo is stored × 10 000,
 * so to four decimals. Any other value outside the stated range stops the
 * build: it is not clamped.
 *
 * Run:  node scripts/build-tes-grids.mjs --cache <dir>
 *       (downloads about 94 MB into <dir> once; nothing of it is committed)
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'src/data/thermal'
const BUILT_ON = new Date().toISOString().slice(0, 10)
const BAND_DEG = 87
const GLOBAL_PX_PER_DEG = 2
/** The Jezero map box, JEZERO.bounds in src/data/sites/sites.ts. */
const JEZERO_BOX = { west: 76.8, east: 77.8, south: 17.7, north: 18.7 }

const PDS = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data'
const USGS = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic'

const TI_CITATION =
  'Putzig, N. E., and Mellon, M. T., 2007, Apparent thermal inertia of Mars from TES, Icarus 191, 68–94, doi 10.1016/j.icarus.2007.05.013; PDS Geosciences "TES Thermal Inertia Maps", MGS-M-TES-5-TIMAP-V1.0, GLOBAL_TI_DAY_2007 (dayside), 20 px/deg. An apparent thermal inertia at the TES pass times, not a bulk property'
const ALBEDO_CITATION =
  'Christensen, P. R., et al., 2001, Mars Global Surveyor Thermal Emission Spectrometer experiment: investigation description and surface science results, J. Geophys. Res. 106, 23823–23871; USGS Mars_MGS_TES_Albedo_mosaic_global_7410m (bolometric albedo), 8 px/deg'

const SOURCES = {
  ti: { file: 'GLOBAL_TI_DAY_2007.IMG', url: `${PDS}/GLOBAL_TI_DAY_2007.IMG`, label: `${PDS}/GLOBAL_TI_DAY_2007.LBL`, bytes: 51_840_000 },
  mask: { file: 'GLOBAL_TI_MSK_DAY_2007.IMG', url: `${PDS}/GLOBAL_TI_MSK_DAY_2007.IMG`, label: `${PDS}/GLOBAL_TI_MSK_DAY_2007.LBL`, bytes: 25_920_000 },
  albedo: {
    file: 'Mars_MGS_TES_Albedo_mosaic_global_7410m.tif',
    url: `${USGS}/Mars_MGS_TES_Albedo_mosaic_global_7410m.tif`,
    label: `${USGS}/Mars_MGS_TES_Albedo_mosaic_global_7410m.lbl`,
    md5Url: `${USGS}/Mars_MGS_TES_Albedo_mosaic_global_7410m.tif.md5`,
    bytes: 16_600_981,
  },
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

async function download(url, path) {
  if (existsSync(path)) return
  console.log(`↓ ${url}`)
  const response = await fetch(url)
  if (!response.ok) fail(`${url}: HTTP ${response.status}`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()))
}

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex')

/** Fails unless a PDS3 label states exactly these keyword values. */
async function checkLabel(url, expected) {
  const response = await fetch(url)
  if (!response.ok) fail(`${url}: HTTP ${response.status}`)
  const text = await response.text()
  for (const [key, value] of Object.entries(expected)) {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+?)"?\\s*$`, 'm'))
    if (m?.[1] !== value) fail(`${url}: ${key} is ${m?.[1] ?? 'missing'}, expected ${value}`)
  }
}

/** The float32 raster of an uncompressed, little-endian, single-band classic TIFF. */
function readTiffFloat32(bytes, width, height) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0) !== 0x4949 || view.getUint16(2, true) !== 42) fail('albedo: not a little-endian classic TIFF')
  const ifd = view.getUint32(4, true)
  const tags = new Map()
  for (let i = 0; i < view.getUint16(ifd, true); i++) {
    const at = ifd + 2 + i * 12
    const type = view.getUint16(at + 2, true)
    const count = view.getUint32(at + 4, true)
    const size = { 3: 2, 4: 4 }[type]
    const read = (k, base) => (type === 3 ? view.getUint16(base + 2 * k, true) : view.getUint32(base + 4 * k, true))
    const base = size !== undefined && size * count <= 4 ? at + 8 : view.getUint32(at + 8, true)
    tags.set(view.getUint16(at, true), size === undefined ? null : Array.from({ length: count }, (_, k) => read(k, base)))
  }
  const one = (tag, name) => tags.get(tag)?.[0] ?? fail(`albedo: TIFF has no ${name}`)
  if (one(256, 'width') !== width || one(257, 'height') !== height) fail('albedo: TIFF size differs from the label')
  if (one(258, 'BitsPerSample') !== 32 || one(339, 'SampleFormat') !== 3) fail('albedo: TIFF is not 32-bit float')
  if (one(259, 'Compression') !== 1) fail('albedo: TIFF is compressed')
  if ((tags.get(277)?.[0] ?? 1) !== 1) fail('albedo: TIFF has more than one band')
  const offsets = tags.get(273)
  const counts = tags.get(279)
  if (!offsets || !counts || offsets.length !== counts.length) fail('albedo: TIFF strip tables are missing')
  const out = new Float32Array(width * height)
  let cell = 0
  for (let s = 0; s < offsets.length; s++) {
    for (let b = 0; b < counts[s]; b += 4) out[cell++] = view.getFloat32(offsets[s] + b, true)
  }
  if (cell !== out.length) fail(`albedo: TIFF strips hold ${cell} cells, expected ${out.length}`)
  return out
}

/**
 * A source raster on the 180° domain, its west edge at −180° and north
 * edge at 90°; `encode(row, col)` returns the uint16 to store (0 = no data).
 */
function makeSource(width, pxPerDeg, encode) {
  return { width, height: width / 2, pxPerDeg, encode }
}

const centreLat = (src, row) => 90 - (row + 0.5) / src.pxPerDeg

function encodeChecked(src, row, col) {
  if (Math.abs(centreLat(src, row)) > BAND_DEG) return 0
  return src.encode(row, col)
}

function globalGrid(src) {
  const width = 360 * GLOBAL_PX_PER_DEG
  const height = 180 * GLOBAL_PX_PER_DEG
  const step = src.pxPerDeg / GLOBAL_PX_PER_DEG
  const cells = new Uint16Array(width * height)
  for (let r = 0; r < height; r++) {
    // The source cell holding the output cell's centre.
    const sr = Math.floor((r + 0.5) * step)
    for (let c = 0; c < width; c++) cells[r * width + c] = encodeChecked(src, sr, Math.floor((c + 0.5) * step))
  }
  return { cells, width, height, pxPerDeg: GLOBAL_PX_PER_DEG, westDeg: -180, northDeg: 90 }
}

function boxGrid(src, box) {
  const eps = 1e-9
  const c0 = Math.floor((box.west + 180) * src.pxPerDeg + eps)
  const c1 = Math.ceil((box.east + 180) * src.pxPerDeg - eps)
  const r0 = Math.floor((90 - box.north) * src.pxPerDeg + eps)
  const r1 = Math.ceil((90 - box.south) * src.pxPerDeg - eps)
  const width = c1 - c0
  const height = r1 - r0
  const cells = new Uint16Array(width * height)
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) cells[r * width + c] = encodeChecked(src, r0 + r, c0 + c)
  // The corners from whole cell counts, divided once: `c0 / px - 180` gave
  // 76.80000000000001, so a point on the box's west edge missed the cut.
  const westDeg = (c0 - 180 * src.pxPerDeg) / src.pxPerDeg
  const northDeg = (90 * src.pxPerDeg - r0) / src.pxPerDeg
  return { cells, width, height, pxPerDeg: src.pxPerDeg, westDeg, northDeg }
}

function write(name, grid, meta) {
  const bytes = Buffer.alloc(grid.cells.length * 2)
  grid.cells.forEach((v, i) => bytes.writeUInt16LE(v, i * 2))
  writeFileSync(join(OUT, `${name}.bin`), bytes)
  const noData = grid.cells.reduce((n, v) => n + (v === 0 ? 1 : 0), 0)
  const sidecar = {
    grid: name,
    ...meta.quantity,
    widthPx: grid.width,
    heightPx: grid.height,
    pxPerDeg: grid.pxPerDeg,
    westDeg: grid.westDeg,
    northDeg: grid.northDeg,
    longitudeDomain: '-180 to 180 east',
    encoding: 'uint16 little-endian, rows north to south, columns west to east',
    noData: 0,
    noDataCells: noData,
    binMd5: md5(bytes),
    citation: meta.citation,
    source: meta.source,
    resampling: meta.resampling,
    noDataRule: meta.noDataRule,
    builtBy: 'scripts/build-tes-grids.mjs',
    builtOn: BUILT_ON,
  }
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(sidecar, null, 2)}\n`)
  console.log(`✓ ${name}: ${grid.width} × ${grid.height}, ${bytes.length} bytes, ${noData} no-data cells`)
}

const cache = argValue('--cache') ?? fail('Usage: node scripts/build-tes-grids.mjs --cache <dir>')
mkdirSync(cache, { recursive: true })
for (const s of Object.values(SOURCES)) await download(s.url, join(cache, s.file))

const IMAGE = { MAP_PROJECTION_TYPE: 'SIMPLE CYLINDRICAL', COORDINATE_SYSTEM_NAME: 'PLANETOCENTRIC', POSITIVE_LONGITUDE_DIRECTION: 'EAST', WESTERNMOST_LONGITUDE: '-180.0 <deg>', MAXIMUM_LATITUDE: '90.00 <deg>', LINES: '3600', LINE_SAMPLES: '7200', SAMPLE_TYPE: 'MSB_INTEGER', 'MAP_RESOLUTION': '20.0 <pix/deg>',
  // The first cell's centre lies 1800.5 lines and 3600.5 samples from (0°N, 0°E),
  // so the edges are at 90°N and −180°E: every row and column index here relies on it.
  LINE_PROJECTION_OFFSET: '1800.5', SAMPLE_PROJECTION_OFFSET: '3600.5' }
await checkLabel(SOURCES.ti.label, { ...IMAGE, SAMPLE_BITS: '16' })
await checkLabel(SOURCES.mask.label, { ...IMAGE, SAMPLE_BITS: '8' })

const tiBytes = readFileSync(join(cache, SOURCES.ti.file))
const maskBytes = readFileSync(join(cache, SOURCES.mask.file))
const albedoBytes = readFileSync(join(cache, SOURCES.albedo.file))
for (const [key, bytes] of [['ti', tiBytes], ['mask', maskBytes], ['albedo', albedoBytes]]) {
  if (bytes.length !== SOURCES[key].bytes) fail(`${SOURCES[key].file} is ${bytes.length} bytes, expected ${SOURCES[key].bytes}`)
}
const publishedMd5 = (await (await fetch(SOURCES.albedo.md5Url)).text()).trim().split(/\s+/)[0]
if (md5(albedoBytes) !== publishedMd5) fail(`albedo MD5 ${md5(albedoBytes)} differs from the published ${publishedMd5}`)
const albedoLabel = await (await fetch(SOURCES.albedo.label)).text()
for (const want of ['Samples = 2880', 'Lines   = 1440', 'ProjectionName     = SimpleCylindrical', 'LatitudeType       = Planetocentric', 'LongitudeDirection = PositiveEast', 'LongitudeDomain    = 180', 'Scale              = 8.0 <pixels/degree>']) {
  if (!albedoLabel.includes(want)) fail(`albedo label lacks "${want}"`)
}

const TI_RANGE = [5, 5000]
const tiSource = makeSource(7200, 20, (row, col) => {
  const i = row * 7200 + col
  const v = tiBytes.readInt16BE(i * 2)
  if (v === 0 || maskBytes[i] === 0) return 0
  if (v < TI_RANGE[0] || v > TI_RANGE[1]) fail(`thermal inertia ${v} at row ${row}, col ${col} is outside ${TI_RANGE.join('–')}`)
  return v
})

const ALBEDO_SCALE = 10_000
const albedo = readTiffFloat32(albedoBytes, 2880, 1440)
const albedoSource = makeSource(2880, 8, (row, col) => {
  const v = albedo[row * 2880 + col]
  // ISIS special pixels are the most negative floats; NaN is no data too.
  if (!Number.isFinite(v) || v < -1e30) return 0
  if (v <= 0 || v >= 1) fail(`albedo ${v} at row ${row}, col ${col} is outside (0, 1)`)
  return Math.round(v * ALBEDO_SCALE)
})

const tiMeta = (resampling) => ({
  quantity: { quantity: 'thermalInertia', unit: 'J m^-2 K^-1 s^-1/2', scale: 1, validRange: TI_RANGE },
  citation: TI_CITATION,
  source: {
    url: SOURCES.ti.url,
    label: SOURCES.ti.label,
    md5: md5(tiBytes),
    mask: { url: SOURCES.mask.url, label: SOURCES.mask.label, md5: md5(maskBytes) },
    note: 'MD5 of the files as downloaded; the PDS volume publishes none',
  },
  resampling,
  noDataRule: `the source's 0 (not derived), a cell its interpolation mask marks as infilled (mask 0), or a cell centred poleward of ${BAND_DEG}°`,
})
const albedoMeta = (resampling) => ({
  quantity: { quantity: 'albedo', unit: 'bolometric albedo, 0–1', scale: 1 / ALBEDO_SCALE, validRange: [0, 1] },
  citation: ALBEDO_CITATION,
  source: { url: SOURCES.albedo.url, label: SOURCES.albedo.label, md5: md5(albedoBytes), note: 'matches the MD5 the USGS publishes beside the file' },
  resampling: `${resampling}; stored × ${ALBEDO_SCALE}, rounded to four decimals`,
  noDataRule: `a NaN or ISIS special pixel in the source, or a cell centred poleward of ${BAND_DEG}°`,
})
const NEAREST = (from) => `nearest: each 0.5° output cell holds the one ${from} source cell containing its centre; nothing averaged`
const CUT = 'none: the source cells overlapping the Jezero map box (76.8–77.8°E, 17.7–18.7°N), as they are'

mkdirSync(OUT, { recursive: true })
write('tes-thermal-inertia-day-global', globalGrid(tiSource), tiMeta(NEAREST('20 px/deg')))
write('tes-thermal-inertia-day-jezero', boxGrid(tiSource, JEZERO_BOX), tiMeta(CUT))
write('tes-albedo-global', globalGrid(albedoSource), albedoMeta(NEAREST('8 px/deg')))
write('tes-albedo-jezero', boxGrid(albedoSource, JEZERO_BOX), albedoMeta(CUT))
