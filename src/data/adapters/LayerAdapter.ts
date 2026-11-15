import {
  derived,
  MARS_MEAN_RADIUS_KM,
  official,
  unavailable,
  type Classified,
  type LegendEntry,
  type MapLayerId,
  type MapLayerLegend,
  type MarsCoordinate,
} from '../../domain'
import { CTX_GROUND_DETAIL, GROUND_DETAIL_SOURCES, type GroundDetailSource } from '../layers/groundDetailSources'
import { LAYER_SOURCES, trekTileUrl, type LayerSource } from '../layers/layerSources'
import type { TileSource } from '../layers/tileSource'
import { defaultJsonIo, type JsonIo } from './jsonIo'

/**
 * Map layer adapter: the only place that knows the Mars Trek tile
 * shape. It turns the verified sources in src/data/layers into `MapLayer`s,
 * and fetches a layer's tiles into one equirectangular image.
 *
 * Every layer is reported, available or not — a layer is never dropped
 * silently, so the menu can show it as unavailable instead of hiding it.
 * Load status stays here, beside the domain `MapLayer`, not inside it.
 */

export type LayerLoadResult =
  | {
      status: 'available'
      source: LayerSource
      /**
       * The finest resolution the tile service serves, at the equator. Can be
       * coarser than `source.sourceResolution`: Trek stops at `maxZoom`.
       */
      servedResolution: Classified<string>
    }
  | { status: 'unavailable'; id: MapLayerId; reason: string }

export type LayerImageState =
  | { status: 'loading' }
  | { status: 'ready'; image: HTMLCanvasElement; zoom: number }
  | { status: 'error'; reason: string }

/**
 * One tile. `empty` is a row the product does not cover: no data,
 * not a failure. An error is `retryable` when asking again could succeed
 * (network failure, server error); not when the request itself is wrong
 * (bad index, 404) or was cancelled.
 */
export type LayerTileResult =
  | { status: 'ready'; image: ImageBitmap }
  | { status: 'empty' }
  | { status: 'error'; reason: string; retryable: boolean }

/** A tile response that was not OK; carries the status so the caller can decide to retry. */
export class TileHttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`The tile server returned ${status} for a tile`)
    this.name = 'TileHttpError'
    this.status = status
  }
}

/**
 * A tile that arrived whole by HTTP but is not a whole image: a PNG cut off
 * before its end. The global CTX mosaic's service has such files in its own
 * cache (zoom 11 round Jezero, seen 2026-11-15: about a third of the tiles,
 * served with a matching Content-Length and a 30-day max-age). A browser
 * decodes what there is and leaves the rest clear, so the tile would be
 * drawn as part of a picture with holes.
 */
export class TileCorruptError extends Error {
  constructor() {
    super('The tile server sent an incomplete image for a tile')
    this.name = 'TileCorruptError'
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** A PNG's last twelve bytes: the empty IEND chunk with its length and CRC. */
const PNG_END = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]

/**
 * Whether a file that starts as a PNG stops before its IEND chunk. `head`
 * is its first 8 bytes or more, `tail` its last 12. A file that is not a PNG
 * is not judged: false.
 */
export function pngIsTruncated(head: Uint8Array, tail: Uint8Array): boolean {
  if (head.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => head[i] !== b)) return false
  const end = tail.subarray(Math.max(0, tail.length - PNG_END.length))
  return end.length < PNG_END.length || PNG_END.some((b, i) => end[i] !== b)
}

/**
 * 404 is permanent (the service has no such tile), and so is an incomplete
 * image, which the service caches as it is; anything else may pass next time.
 */
function retryableTileError(error: unknown): boolean {
  if (error instanceof TileCorruptError) return false
  return !(error instanceof TileHttpError && error.status === 404)
}

/** Mars Trek tiles are 256 px; the ground-detail mosaic's are 512. */
const TILE_PX = 256
/**
 * Highest zoom fetched as one whole-globe image: 16 × 8 tiles, 4096 × 2048 px.
 * Finer levels are thousands of tiles and need per-region loading.
 */
export const MAX_GLOBE_ZOOM = 3

/** Why a source record cannot be shown, or null when it can. */
export function validateLayerSource(s: LayerSource): string | null {
  if (s.layer.source.trim() === '') return 'No source recorded'
  if (s.layer.licence.trim() === '') return 'No licence recorded'
  if (s.trekLayer.trim() === '') return 'No Trek layer name recorded'
  if (!Number.isInteger(s.maxZoom) || s.maxZoom < 0) {
    return `Invalid maximum zoom: ${s.maxZoom}`
  }
  return coverageProblem(s.coverage)
}

/** Why a coverage box is unusable, or null. Longitudes are the grid's −180 to 180. */
function coverageProblem({ south, north, west, east }: TileSource['coverage']): string | null {
  if (!(south >= -90 && south < north && north <= 90)) {
    return `Invalid latitude coverage: ${south}..${north}`
  }
  if (west === undefined && east === undefined) return null
  if (west === undefined || east === undefined || !(west >= -180 && west < east && east <= 180)) {
    return `Invalid longitude coverage: ${west}..${east}`
  }
  return null
}

export type GroundDetailResult =
  | { status: 'available'; source: GroundDetailSource }
  | { status: 'unavailable'; reason: string }

/** Why the ground-detail source cannot be used, or null when it can. */
export function validateGroundDetail(s: GroundDetailSource): string | null {
  if (s.source.trim() === '') return 'No source recorded'
  if (s.licence.trim() === '') return 'No licence recorded'
  if (s.credit.trim() === '') return 'No credit line recorded'
  if (!Number.isInteger(s.maxZoom) || s.maxZoom < 0) return `Invalid maximum zoom: ${s.maxZoom}`
  if (s.tilePx !== 256 && s.tilePx !== 512) return `Unexpected tile size: ${s.tilePx}`
  return coverageProblem(s.coverage)
}

/** The ground-detail mosaic, available or the reason it is not. Never throws. */
export function describeGroundDetail(source: GroundDetailSource = CTX_GROUND_DETAIL): GroundDetailResult {
  const problem = validateGroundDetail(source)
  return problem === null ? { status: 'available', source } : { status: 'unavailable', reason: problem }
}

/** Every ground-detail mosaic, finest first, each available or the reason it is not. Never throws. */
export function describeGroundDetails(
  sources: readonly GroundDetailSource[] = GROUND_DETAIL_SOURCES,
): GroundDetailResult[] {
  return sources.map((s) => describeGroundDetail(s))
}

/**
 * The finest usable ground-detail source whose coverage holds `at`:
 * the 25 cm HiRISE mosaic inside its Jezero box, the 6 m Jezero CTX mosaic
 * in its wider box, the global CTX mosaic elsewhere. Inside its box HiRISE
 * can still be transparent where it took no image, so a renderer keeps the
 * next source underneath. Unavailable
 * when no valid source covers the point, with every reason. Never throws.
 */
export function groundDetailAt(
  at: MarsCoordinate,
  sources: readonly GroundDetailSource[] = GROUND_DETAIL_SOURCES,
): GroundDetailResult {
  // The grid runs −180 to 180; the domain keeps 0–360°E.
  const lon = at.longitudeEast > 180 ? at.longitudeEast - 360 : at.longitudeEast
  const reasons: string[] = []
  for (const source of sources) {
    const { south, north, west = -180, east = 180 } = source.coverage
    // Written as "inside", so a NaN coordinate is inside nothing.
    if (!(at.latitude >= south && at.latitude <= north && lon >= west && lon <= east)) continue
    const result = describeGroundDetail(source)
    if (result.status === 'available') return result
    reasons.push(`${source.label}: ${result.reason}`)
  }
  return {
    status: 'unavailable',
    reason: reasons.length > 0 ? reasons.join('; ') : 'No ground-detail source covers this point',
  }
}

/** One result per layer id, in `LAYER_SOURCES` order. Never fewer. */
export function describeLayers(
  sources: Record<MapLayerId, LayerSource | null> = LAYER_SOURCES,
): LayerLoadResult[] {
  // `sources` is a Record over MapLayerId, so its keys are exactly those ids;
  // Object.keys only loses that in its string[] signature.
  return (Object.keys(sources) as MapLayerId[]).map((id) => {
    const source = sources[id]
    if (source === null) {
      return { status: 'unavailable', id, reason: 'No verified source for this layer yet' }
    }
    if (source.layer.id !== id) {
      return { status: 'unavailable', id, reason: `Source is for layer '${source.layer.id}'` }
    }
    const problem = validateLayerSource(source)
    if (problem !== null) return { status: 'unavailable', id, reason: problem }
    return { status: 'available', source, servedResolution: servedResolution(source.maxZoom) }
  })
}

/** Trek's equirectangular grid: 2^(z+1) × 2^z tiles, from 180°W and 90°N. */
export function tileGrid(zoom: number): { cols: number; rows: number } {
  return { cols: 2 ** (zoom + 1), rows: 2 ** zoom }
}

/**
 * Latitude band of one tile row at `zoom`, degrees north, top edge first.
 * Row 0 starts at 90°N; every row spans 180° / 2^zoom.
 */
export function tileRowBand(zoom: number, row: number): { north: number; south: number } {
  const span = 180 / tileGrid(zoom).rows
  const north = 90 - row * span
  return { north, south: north - span }
}

/**
 * Whether a tile row can hold any of the source's data. Mars Trek returns
 * HTTP 404, not an empty tile, for rows wholly outside the product's
 * coverage (THEMIS poleward of 65°, verified 2026-10-19), so those rows must
 * not be requested at all.
 */
export function rowInCoverage(source: Pick<TileSource, 'coverage'>, zoom: number, row: number): boolean {
  const band = tileRowBand(zoom, row)
  return band.south < source.coverage.north && band.north > source.coverage.south
}

/**
 * Whether a tile can hold any of the source's data: its row as above, and
 * for a regional source its column too. Trek answers 404 outside the
 * Jezero HiRISE box (verified 2026-10-28), so those tiles are not requested.
 */
export function tileInCoverage(
  source: Pick<TileSource, 'coverage'>,
  zoom: number,
  row: number,
  col: number,
): boolean {
  if (!rowInCoverage(source, zoom, row)) return false
  const { west, east } = source.coverage
  if (west === undefined || east === undefined) return true
  const span = 360 / tileGrid(zoom).cols
  const colWest = -180 + col * span
  return colWest < east && colWest + span > west
}

export function tileUrl(source: LayerSource, zoom: number, row: number, col: number): string {
  return trekTileUrl(source.trekLayer, source.format, zoom, row, col, source.host)
}

/** A Trek layer as the tile loader sees it: 256 px tiles at Trek's URL. */
export function tileSourceOf(source: LayerSource): TileSource {
  return {
    label: source.layer.label,
    maxZoom: source.maxZoom,
    tilePx: TILE_PX,
    coverage: source.coverage,
    tileUrl: (zoom, row, col) => tileUrl(source, zoom, row, col),
  }
}

/** DERIVED from the tile grid width at `zoom`, the tile size and the mean radius. */
export function servedResolution(zoom: number, tilePx: number = TILE_PX): Classified<string> {
  const widthPx = tileGrid(zoom).cols * tilePx
  const metresPerPx = (2 * Math.PI * MARS_MEAN_RADIUS_KM * 1000) / widthPx
  // Two significant figures under 10 m, so the HiRISE zooms do not round to 0 m/px.
  const scale =
    metresPerPx >= 1000
      ? `${(metresPerPx / 1000).toFixed(1)} km/px`
      : metresPerPx >= 10
        ? `${Math.round(metresPerPx)} m/px`
        : `${Number(metresPerPx.toPrecision(2))} m/px`
  return derived(
    `≈ ${scale} at the equator (${(widthPx / 360).toFixed(1)} px/deg)`,
    `Zoom ${zoom} grid is ${widthPx} px around the equator; equatorial ` +
      `circumference from the mean radius ${MARS_MEAN_RADIUS_KM} km ÷ ${widthPx}`,
  )
}

/**
 * Fetches one tile at `zoom`, for detail on top of the whole-globe
 * image. Never rejects. A row wholly outside the source's coverage is not
 * requested (Trek has no tile there) and comes back `empty`; a zoom the
 * source does not serve, a bad index or a failed fetch is an `error`. The
 * caller owns the bitmap and must close it.
 */
export async function loadLayerTile(
  from: LayerSource | TileSource,
  zoom: number,
  row: number,
  col: number,
  signal: AbortSignal,
  io: TileIo = browserIo,
): Promise<LayerTileResult> {
  const source = 'layer' in from ? tileSourceOf(from) : from
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > source.maxZoom) {
    return { status: 'error', reason: `${source.label} is not served at zoom ${zoom}`, retryable: false }
  }
  const { cols, rows } = tileGrid(zoom)
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rows || col < 0 || col >= cols) {
    return {
      status: 'error',
      reason: `No tile ${zoom}/${row}/${col} in a ${cols} × ${rows} grid`,
      retryable: false,
    }
  }
  if (!tileInCoverage(source, zoom, row, col)) return { status: 'empty' }
  if (signal.aborted) return { status: 'error', reason: 'Cancelled', retryable: false }
  try {
    const image = await io.fetchTile(source.tileUrl(zoom, row, col), signal)
    if (signal.aborted) {
      image.close()
      return { status: 'error', reason: 'Cancelled', retryable: false }
    }
    return { status: 'ready', image }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      reason: `${source.label} tile failed to load: ${message}`,
      retryable: retryableTileError(error),
    }
  }
}

export interface PlacedTile {
  tile: ImageBitmap
  row: number
  col: number
}

/** Browser I/O, injectable so the loader can be tested without a canvas. */
export interface TileIo {
  fetchTile(url: string, signal: AbortSignal): Promise<ImageBitmap>
  stitch(tiles: PlacedTile[], widthPx: number, heightPx: number): HTMLCanvasElement
}

const browserIo: TileIo = {
  async fetchTile(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new TileHttpError(response.status)
    const blob = await response.blob()
    const [head, tail] = await Promise.all([blob.slice(0, 8).arrayBuffer(), blob.slice(-12).arrayBuffer()])
    if (pngIsTruncated(new Uint8Array(head), new Uint8Array(tail))) throw new TileCorruptError()
    return createImageBitmap(blob)
  },
  stitch(tiles, widthPx, heightPx) {
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas not available')
    for (const { tile, row, col } of tiles) ctx.drawImage(tile, col * TILE_PX, row * TILE_PX)
    return canvas
  },
}

/**
 * Fetches every tile of a layer at `zoom` and stitches one whole-globe image.
 * Never rejects: a failure is an `error` state, and one failed tile fails the
 * whole image — a half-drawn layer would show an invented surface. A zoom
 * finer than the source serves is refused rather than upscaled. Rows wholly
 * outside `source.coverage` are not requested (the service has no tile
 * there) and stay transparent on the canvas: no data, not a dark surface.
 * The caller owns the canvas.
 */
export async function loadLayerImage(
  source: LayerSource,
  zoom: number,
  signal: AbortSignal,
  io: TileIo = browserIo,
): Promise<Exclude<LayerImageState, { status: 'loading' }>> {
  if (!Number.isInteger(zoom) || zoom < 0) {
    return { status: 'error', reason: `Invalid zoom: ${zoom}` }
  }
  if (zoom > source.maxZoom) {
    return {
      status: 'error',
      reason: `${source.layer.label} is served only up to zoom ${source.maxZoom}`,
    }
  }
  if (zoom > MAX_GLOBE_ZOOM) {
    return {
      status: 'error',
      reason: `Whole-globe images stop at zoom ${MAX_GLOBE_ZOOM}; finer needs regional tiles`,
    }
  }

  // An already-aborted signal never fires its listener, so without this the
  // whole grid would be fetched before "Cancelled" was reported.
  if (signal.aborted) return { status: 'error', reason: 'Cancelled' }

  // One failed tile fails the image, so stop the other fetches too.
  const batch = new AbortController()
  const onAbort = () => batch.abort()
  signal.addEventListener('abort', onAbort, { once: true })

  const { cols, rows } = tileGrid(zoom)
  const jobs: Promise<PlacedTile>[] = []
  // The first real failure; the aborts it causes in the other fetches are not it.
  let firstError: unknown = null
  for (let row = 0; row < rows; row++) {
    if (!rowInCoverage(source, zoom, row)) continue
    for (let col = 0; col < cols; col++) {
      jobs.push(
        io.fetchTile(tileUrl(source, zoom, row, col), batch.signal).then(
          (tile) => ({ tile, row, col }),
          (error: unknown) => {
            firstError ??= error
            batch.abort()
            throw error
          },
        ),
      )
    }
  }

  // Settle every job, so no bitmap that did arrive is left open.
  const settled = await Promise.allSettled(jobs)
  signal.removeEventListener('abort', onAbort)
  const tiles = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))

  try {
    if (signal.aborted) return { status: 'error', reason: 'Cancelled' }
    if (tiles.length < jobs.length) {
      const message = firstError instanceof Error ? firstError.message : String(firstError)
      return { status: 'error', reason: `${source.layer.label} failed to load: ${message}` }
    }
    const image = io.stitch(tiles, cols * TILE_PX, rows * TILE_PX)
    return { status: 'ready', image, zoom }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 'error', reason: `${source.layer.label} failed to load: ${message}` }
  } finally {
    for (const { tile } of tiles) tile.close()
  }
}

/** A categorical legend's source record, as `MapLayer.legend` carries it. */
export type CategoriesLegend = Extract<MapLayerLegend, { kind: 'categories' }>

/** Browser I/O for a legend, injectable like TileIo: the adapters' one JSON fetch. */
export type LegendIo = JsonIo

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Standard base64 (RFC 4648 §4), padded to a multiple of four, as ArcGIS sends `imageData`. */
const isBase64 = (v: string): boolean => v.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(v)

/**
 * Reads a categorical legend from the producer's ArcGIS legend
 * endpoint, the only place that knows its shape: `{ layers: [{ legend:
 * [{ label, imageData, contentType }] }] }`, one swatch image per class.
 * Never rejects. Validated at the boundary: a response without that shape,
 * an entry without a name or an image, or an empty legend is UNAVAILABLE
 * with the reason, never a partial legend. The entries are OFFICIAL with
 * the legend's own citation.
 */
export async function loadLayerLegend(
  legend: CategoriesLegend,
  signal: AbortSignal,
  io: LegendIo = defaultJsonIo,
): Promise<Classified<LegendEntry[]>> {
  if (signal.aborted) return unavailable('Cancelled')
  let body: unknown
  try {
    body = await io.fetchJson(legend.legendUrl, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return unavailable(`Official legend failed to load: ${message}`)
  }
  if (signal.aborted) return unavailable('Cancelled')
  const problem = parseArcgisLegend(body)
  return typeof problem === 'string'
    ? unavailable(`Official legend not understood: ${problem}`)
    : official(problem, legend.source)
}

/** The entries, or why the body is not an ArcGIS legend. Exported for tests. */
export function parseArcgisLegend(body: unknown): LegendEntry[] | string {
  if (!isRecord(body) || !Array.isArray(body.layers)) return 'no "layers" list'
  const first: unknown = body.layers[0]
  if (!isRecord(first) || !Array.isArray(first.legend)) return 'the first layer has no "legend" list'
  const entries: LegendEntry[] = []
  for (const item of first.legend as unknown[]) {
    if (!isRecord(item)) return 'an entry is not an object'
    const { label, imageData, contentType } = item
    if (typeof label !== 'string' || label.trim() === '') return 'an entry has no label'
    if (typeof imageData !== 'string' || imageData === '') return `"${label}" has no swatch image`
    if (!isBase64(imageData)) return `"${label}" has a swatch that is not base64`
    if (typeof contentType !== 'string' || !contentType.startsWith('image/')) {
      return `"${label}" has a swatch that is not an image`
    }
    entries.push({ label, swatchUrl: `data:${contentType};base64,${imageData}` })
  }
  return entries.length === 0 ? 'the legend is empty' : entries
}
