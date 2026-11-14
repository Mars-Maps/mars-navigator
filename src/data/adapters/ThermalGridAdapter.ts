import {
  official,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type SurfaceThermalProperties,
  type ThermalPropertiesLookup,
} from '../../domain'
import albedoGlobalBin from '../thermal/tes-albedo-global.bin?url'
import albedoGlobalJson from '../thermal/tes-albedo-global.json?url'
import albedoJezeroBin from '../thermal/tes-albedo-jezero.bin?url'
import albedoJezeroJson from '../thermal/tes-albedo-jezero.json?url'
import inertiaGlobalBin from '../thermal/tes-thermal-inertia-day-global.bin?url'
import inertiaGlobalJson from '../thermal/tes-thermal-inertia-day-global.json?url'
import inertiaJezeroBin from '../thermal/tes-thermal-inertia-day-jezero.bin?url'
import inertiaJezeroJson from '../thermal/tes-thermal-inertia-day-jezero.json?url'
import { TES_GRIDS_READING_REASON } from './thermalGridReasons'

/**
 * The TES thermal inertia and albedo at any point, read from the
 * four grids `scripts/build-tes-grids.mjs` commits under `src/data/thermal/`:
 * each map at full resolution over the Jezero map box and at 2 px/deg
 * everywhere else. Each grid is a `.bin` of little-endian uint16 cells
 * (0 = no data) with a `.json` sidecar; both are checked here before any
 * number leaves: the sidecar's shape, the file's length and every cell's
 * range. One bad grid makes its quantity UNAVAILABLE everywhere, with the
 * reason, rather than leaving holes that look like data.
 *
 * A point reads the nearest cell, the one it falls in, with no
 * interpolation; the Jezero grid where the point is inside it, the global
 * one elsewhere. A no-data cell is UNAVAILABLE: never 0, and never the
 * coarser grid's value, which would come from a cell centred elsewhere.
 */

export type ThermalQuantity = 'thermalInertia' | 'albedo'

export interface ThermalGrid {
  name: string
  quantity: ThermalQuantity
  /** Stored value × scale = the quantity in its unit. */
  scale: number
  validRange: readonly [number, number]
  widthPx: number
  heightPx: number
  pxPerDeg: number
  /** West and north edges of the grid, degrees, longitude in the −180 to 180 east domain. */
  westDeg: number
  northDeg: number
  citation: string
  resampling: string
  noDataRule: string
  cells: Uint16Array
}

export class ThermalGridError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ThermalGridError'
  }
}

/** The band the TES thermal inertia maps were infilled to; the build makes cells beyond it no-data. */
export const TES_BAND_DEG = 87

export { TES_GRIDS_READING_REASON } from './thermalGridReasons'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

/** A grid from its sidecar and its bytes, or a `ThermalGridError` saying what is wrong. */
export function parseThermalGrid(sidecar: unknown, bytes: ArrayBuffer, expected: ThermalQuantity): ThermalGrid {
  if (!isRecord(sidecar)) throw new ThermalGridError('the sidecar is not a JSON object')
  const name = typeof sidecar.grid === 'string' ? sidecar.grid : 'the grid'
  const bad = (why: string) => new ThermalGridError(`${name}: ${why}`)
  const { quantity, scale, validRange, widthPx, heightPx, pxPerDeg, westDeg, northDeg, citation, resampling, noDataRule, noData } = sidecar
  if (quantity !== expected) throw bad(`holds ${String(quantity)}, expected ${expected}`)
  if (typeof scale !== 'number' || !(scale > 0)) throw bad('has no positive scale')
  if (!Array.isArray(validRange) || validRange.length !== 2 || !validRange.every((v) => typeof v === 'number') || !(validRange[0] < validRange[1])) {
    throw bad('has no valid range')
  }
  if (!isPositiveInt(widthPx) || !isPositiveInt(heightPx) || !isPositiveInt(pxPerDeg)) throw bad('has no whole-number size and resolution')
  if (typeof westDeg !== 'number' || typeof northDeg !== 'number') throw bad('has no west or north edge')
  if (westDeg < -180 || westDeg + widthPx / pxPerDeg > 180 || northDeg > 90 || northDeg - heightPx / pxPerDeg < -90) {
    throw bad('extends past the globe')
  }
  if (noData !== 0) throw bad('uses a no-data value other than 0')
  if (typeof citation !== 'string' || citation === '') throw bad('has no citation')
  if (typeof resampling !== 'string' || typeof noDataRule !== 'string') throw bad('does not state its resampling and no-data rule')
  if (bytes.byteLength !== widthPx * heightPx * 2) {
    throw bad(`is ${bytes.byteLength} bytes, expected ${widthPx} × ${heightPx} × 2 = ${widthPx * heightPx * 2}`)
  }
  const view = new DataView(bytes)
  const cells = new Uint16Array(widthPx * heightPx)
  const [lo, hi] = validRange as [number, number]
  for (let i = 0; i < cells.length; i++) {
    const v = view.getUint16(i * 2, true)
    if (v !== 0 && (v * scale < lo || v * scale > hi)) {
      throw bad(`cell ${i} holds ${v * scale}, outside ${lo}–${hi}`)
    }
    cells[i] = v
  }
  return { name, quantity: expected, scale, validRange: [lo, hi], widthPx, heightPx, pxPerDeg, westDeg, northDeg, citation, resampling, noDataRule, cells }
}

/** The −180 to 180 east longitude of a 0–360 east one. */
const toEast180 = (longitudeEast: number) => (longitudeEast >= 180 ? longitudeEast - 360 : longitudeEast)

/** The row and column the point falls in, or null when it is outside the grid. */
export function cellAt(grid: ThermalGrid, point: MarsCoordinate): { row: number; col: number } | null {
  const lon = toEast180(point.longitudeEast)
  let col = Math.floor((lon - grid.westDeg) * grid.pxPerDeg)
  let row = Math.floor((grid.northDeg - point.latitude) * grid.pxPerDeg)
  // The east edge at 180° and the south pole belong to the last column and row.
  // A NaN coordinate passes every bound check below, so it would read cells[NaN].
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null
  if (col === grid.widthPx && lon === grid.westDeg + grid.widthPx / grid.pxPerDeg) col -= 1
  if (row === grid.heightPx && point.latitude === grid.northDeg - grid.heightPx / grid.pxPerDeg) row -= 1
  if (col < 0 || col >= grid.widthPx || row < 0 || row >= grid.heightPx) return null
  return { row, col }
}

const roundTo = (v: number, decimals: number) => Number(v.toFixed(decimals))

function readCell(grid: ThermalGrid, row: number, col: number): Classified<number> {
  const centreLat = grid.northDeg - (row + 0.5) / grid.pxPerDeg
  const centreLon = grid.westDeg + (col + 0.5) / grid.pxPerDeg
  const where = `${roundTo(Math.abs(centreLat), 3)}°${centreLat < 0 ? 'S' : 'N'}, ${roundTo((centreLon + 360) % 360, 3)}°E`
  const v = grid.cells[row * grid.widthPx + col]
  if (v === 0) return unavailable(`No ${grid.quantity === 'albedo' ? 'albedo' : 'thermal inertia'} in the TES map's cell here (${where}): ${grid.noDataRule}`)
  const decimals = Math.max(0, Math.round(-Math.log10(grid.scale)))
  return official(
    roundTo(v * grid.scale, decimals),
    `${grid.citation}. The ${grid.pxPerDeg} px/deg cell the point falls in, centred ${where}, nearest cell with no interpolation (grid ${grid.name}; resampling: ${grid.resampling})`,
  )
}

export interface TesThermalGrids {
  thermalInertia(point: MarsCoordinate): Classified<number>
  albedo(point: MarsCoordinate): Classified<number>
  /** Both at once, the shape the temperature model binds. */
  properties: ThermalPropertiesLookup
  /** The grids as read, for drawing them whole; a failed set carries its reason. */
  sets: { thermalInertia: GridSet; albedo: GridSet }
}

/** A quantity's grids, the finer Jezero cut first; or the reason they could not be read. */
export type GridSet = { site: ThermalGrid; global: ThermalGrid } | { failed: string }

function lookupFor(set: GridSet): (point: MarsCoordinate) => Classified<number> {
  return (point) => {
    if ('failed' in set) return unavailable(set.failed)
    if (Math.abs(point.latitude) > TES_BAND_DEG) {
      return unavailable(`Outside the TES maps' ${TES_BAND_DEG}°S–${TES_BAND_DEG}°N band, where the thermal inertia maps were infilled`)
    }
    for (const grid of [set.site, set.global]) {
      const at = cellAt(grid, point)
      if (at !== null) return readCell(grid, at.row, at.col)
    }
    return unavailable('The point is not on the TES grids')
  }
}

/** The lookups over grids already read. */
export function tesThermalGrids(inertia: GridSet, albedo: GridSet): TesThermalGrids {
  const thermalInertia = lookupFor(inertia)
  const albedoAt = lookupFor(albedo)
  return {
    thermalInertia,
    albedo: albedoAt,
    properties: (point): SurfaceThermalProperties => ({ thermalInertia: thermalInertia(point), albedo: albedoAt(point) }),
    sets: { thermalInertia: inertia, albedo },
  }
}

/** Every point UNAVAILABLE with the same reason: while the grids are read, or when the read failed. */
export function tesThermalGridsUnavailable(reason: string = TES_GRIDS_READING_REASON): TesThermalGrids {
  return tesThermalGrids({ failed: reason }, { failed: reason })
}

export interface BytesIo {
  fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer>
}

export const defaultBytesIo: BytesIo = {
  async fetchBytes(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.arrayBuffer()
  },
}

/** The committed files, by quantity: the sidecar and the cells of each grid. */
export const TES_GRID_FILES: Record<ThermalQuantity, { site: { json: string; bin: string }; global: { json: string; bin: string } }> = {
  thermalInertia: {
    site: { json: inertiaJezeroJson, bin: inertiaJezeroBin },
    global: { json: inertiaGlobalJson, bin: inertiaGlobalBin },
  },
  albedo: {
    site: { json: albedoJezeroJson, bin: albedoJezeroBin },
    global: { json: albedoGlobalJson, bin: albedoGlobalBin },
  },
}

const LABEL: Record<ThermalQuantity, string> = { thermalInertia: 'TES thermal inertia', albedo: 'TES albedo' }

async function readSet(quantity: ThermalQuantity, signal: AbortSignal, io: BytesIo): Promise<GridSet> {
  const files = TES_GRID_FILES[quantity]
  // Named by grid, not URL: a production build inlines small files as `data:` URIs.
  const read = async (f: { json: string; bin: string }, which: 'Jezero' | 'global') => {
    const [json, bin] = await Promise.all([io.fetchBytes(f.json, signal), io.fetchBytes(f.bin, signal)])
    let sidecar: unknown
    try {
      sidecar = JSON.parse(new TextDecoder().decode(json))
    } catch {
      throw new ThermalGridError(`the ${which} grid's sidecar is not JSON`)
    }
    return parseThermalGrid(sidecar, bin, quantity)
  }
  try {
    const [site, global] = await Promise.all([read(files.site, 'Jezero'), read(files.global, 'global')])
    return { site, global }
  } catch (error: unknown) {
    const why = signal.aborted ? 'Cancelled' : error instanceof Error ? error.message : String(error)
    return { failed: `The ${LABEL[quantity]} grid failed to load: ${why}` }
  }
}

/**
 * Reads and checks all four grids. Never rejects: a quantity whose grids
 * fail answers UNAVAILABLE with the reason, and the other still answers.
 */
export async function loadTesThermalGrids(signal: AbortSignal, io: BytesIo = defaultBytesIo): Promise<TesThermalGrids> {
  const [inertia, albedo] = await Promise.all([readSet('thermalInertia', signal, io), readSet('albedo', signal, io)])
  return tesThermalGrids(inertia, albedo)
}
