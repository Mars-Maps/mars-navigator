import {
  describeGroundDetails,
  describeLayers,
  loadLayerImage,
  loadLayerTile,
  servedResolution,
  type CategoriesLegend,
  type GroundDetailResult,
  type LayerLoadResult,
  type TileIo,
} from '../data/adapters/LayerAdapter'
import { LAYER_SOURCES, THERMAL_NIGHT_SOURCE } from '../data/layers/layerSources'
import { BASE_MAP_LAYER_ID, type MapLayer, type MapLayerId } from '../domain'
import type { GroundImagery, SurfaceDetail } from '../features/mars-3d/surfaceDetail'
import { NO_DATA_CSS, isGridVariant, type SurfaceBase, type SurfaceImage, type ThermalVariant } from '../state'

/**
 * How the globe gets its surface. The shell is the one place that
 * may call the layer adapter, so it reads the layer catalogue and loads the
 * active layer's image here, and the scene reads the result from the store.
 */

/**
 * Whole-globe zoom: 8 × 4 tiles, 2048 × 1024 px, about 1.5 MB per layer,
 * the same as globe v1 showed. Zoom 3 is four times the pixels; whether the
 * close-up view needs it is the performance pass's call.
 */
export const GLOBE_ZOOM = 2

/**
 * Drawn greyed and dimmed under every other layer where that layer has no
 * data (THEMIS poleward of 65°, TES wherever the surface is dusty), so the
 * globe never has holes and colour always means data.
 */
export const BASE_LAYER_ID: MapLayerId = BASE_MAP_LAYER_ID

export interface LayerCatalogue {
  /** Layers that can be shown, in adapter order, for the store and the menu. */
  layers: MapLayer[]
  /** Every result by id, unavailable ones included, so a reason is never lost. */
  byId: Map<MapLayerId, LayerLoadResult>
}

export function readLayerCatalogue(results: LayerLoadResult[] = describeLayers()): LayerCatalogue {
  const byId = new Map<MapLayerId, LayerLoadResult>()
  const layers: MapLayer[] = []
  for (const result of results) {
    if (result.status === 'available') {
      byId.set(result.source.layer.id, result)
      layers.push(result.source.layer)
    } else {
      byId.set(result.id, result)
    }
  }
  return { layers, byId }
}

/** The night mosaic's entry for the thermal layer, checked like every layer source. */
export function describeThermalNight(): LayerLoadResult {
  const thermal = describeLayers({ ...LAYER_SOURCES, thermal: THERMAL_NIGHT_SOURCE }).find(
    (r) => (r.status === 'available' ? r.source.layer.id : r.id) === 'thermal',
  )
  return thermal ?? { status: 'unavailable', id: 'thermal', reason: 'The night mosaic is not in the catalogue' }
}

/**
 * The catalogue with the thermal layer as the user chose it:
 * the day catalogue as it is; with its thermal entry replaced by the night
 * mosaic, so the menu, the caption and the tiles all name the mosaic shown;
 * or, for a grid variant, with the grid's own layer in the menu once its
 * chunk has described it (`gridLayer`), the tile entry kept in `byId` but
 * never loaded. Every other entry stays the same object, so nothing else
 * reloads.
 */
export function withThermalVariant(
  day: LayerCatalogue,
  variant: ThermalVariant,
  night: LayerLoadResult = describeThermalNight(),
  gridLayer: MapLayer | null = null,
): LayerCatalogue {
  if (variant === 'day') return day
  if (isGridVariant(variant)) {
    if (gridLayer === null) return day
    return { layers: day.layers.map((l) => (l.id === 'thermal' ? gridLayer : l)), byId: day.byId }
  }
  const byId = new Map(day.byId)
  byId.set('thermal', night)
  const layers = day.layers.flatMap((l) =>
    l.id !== 'thermal' ? [l] : night.status === 'available' ? [night.source.layer] : [],
  )
  return { layers, byId }
}

/**
 * The categorical legend still to read for the active layer: its
 * legend record when the layer is in the catalogue, has one, and nothing has
 * been read for it yet; null otherwise. Read on first selection, not at
 * load, so a layer never shown costs no request.
 */
export function pendingLegend(
  layers: readonly MapLayer[],
  activeLayerId: MapLayerId,
  loaded: Partial<Record<MapLayerId, unknown>>,
): CategoriesLegend | null {
  if (loaded[activeLayerId] !== undefined) return null
  const legend = layers.find((l) => l.id === activeLayerId)?.legend
  return legend?.kind === 'categories' ? legend : null
}

/** Never finer than the service serves: a coarse layer loads coarse rather than not at all. */
export function globeZoomFor(maxZoom: number): number {
  return Math.min(GLOBE_ZOOM, maxZoom)
}

/**
 * Loads the whole-globe image for `id`. Never rejects: anything that stops
 * the picture appearing is an `unavailable` state with the reason, so the
 * scene can say so instead of keeping the previous layer on screen.
 */
export async function loadSurfaceImage(
  id: MapLayerId,
  result: LayerLoadResult | undefined,
  signal: AbortSignal,
  io?: TileIo,
): Promise<SurfaceImage> {
  if (result === undefined) {
    return { status: 'unavailable', layerId: id, reason: 'Not in the layer catalogue' }
  }
  if (result.status === 'unavailable') {
    return { status: 'unavailable', layerId: id, reason: result.reason }
  }
  const { source } = result
  const loaded = await loadLayerImage(source, globeZoomFor(source.maxZoom), signal, io)
  if (loaded.status === 'error') {
    return { status: 'unavailable', layerId: id, reason: loaded.reason }
  }
  return {
    status: 'ready',
    layerId: id,
    image: loaded.image,
    sourceResolution: source.sourceResolution,
    servedResolution: servedResolutionFor(loaded.zoom, result),
    // Until withBaseUnder runs; a layer shown without it says so honestly.
    base: { status: 'unavailable', reason: 'Base map not drawn' },
  }
}

/**
 * The scene's handle on a layer's detail tiles: the adapter's tile
 * loader behind a function, plus the finest zoom it serves. null for a
 * layer the catalogue cannot show.
 */
export function surfaceDetailFor(
  id: MapLayerId,
  result: LayerLoadResult | undefined,
  io?: TileIo,
): SurfaceDetail | null {
  if (result === undefined || result.status !== 'available') return null
  const { source } = result
  return {
    layerId: id,
    maxZoom: source.maxZoom,
    loadTile: (zoom, row, col, signal) => loadLayerTile(source, zoom, row, col, signal, io),
    resolutionAt: servedResolution,
  }
}

/**
 * The base map's detail tiles under a thermal grid layer, drawn
 * greyscale like the base under the grid's gaps, so the crater shows
 * through the grid's colours at close range without tinting them. null when
 * the base map cannot be tiled.
 */
export function baseDetailUnderGrid(result: LayerLoadResult | undefined, io?: TileIo): SurfaceDetail | null {
  const detail = surfaceDetailFor(BASE_LAYER_ID, result, io)
  return detail === null ? null : { ...detail, greyUnder: true }
}

/**
 * The surface view's finer ground imagery: the ground-detail mosaic
 * as a tile loader plus the caption's text, or null when the source cannot
 * be used. The shell offers it only under the satellite layer, whose colour
 * it sharpens; a data layer's colour means something and is left alone.
 */
export function groundImageryFor(result: GroundDetailResult, io?: TileIo): GroundImagery | null {
  if (result.status !== 'available') return null
  const { source } = result
  const { south, north, west, east } = source.coverage
  return {
    detail: {
      layerId: source.id,
      maxZoom: source.maxZoom,
      loadTile: (zoom, row, col, signal) => loadLayerTile(source, zoom, row, col, signal, io),
      resolutionAt: (zoom) => servedResolution(zoom, source.tilePx),
    },
    tilePx: source.tilePx,
    // A latitude band alone (the global mosaic) loads everywhere; its empty rows come back empty.
    coverage: west === undefined || east === undefined ? null : { south, north, west, east },
    classification: source.classification,
    label: source.label,
    credit: source.credit,
    caveat: source.caveat,
    licence: source.licence,
  }
}

/**
 * Mosaics for the near-field image around the walker only, not the 40 km
 * ground patch. HiRISE's 25 cm shows nothing there: the patch image
 * is ≈ 20 m/px, and its box lies inside the Jezero CTX box, which is
 * opaque. It would only add requests, a canvas and a tonal seam.
 */
const NEAR_FIELD_ONLY: readonly string[] = ['jezero-hirise']

/**
 * The ground-detail mosaics the surface view uses, coarsest first:
 * the data layer lists them finest first for a point lookup, and the scene
 * draws each over the ones before it. Those marked `nearField` are drawn
 * only around the walker. Sources that fail validation are left out rather
 * than offered half-described.
 */
export function groundImageryList(
  results: readonly GroundDetailResult[] = describeGroundDetails(),
  io?: TileIo,
): GroundImagery[] {
  return [...results]
    .reverse()
    .map((r) => groundImageryFor(r, io))
    .filter((g) => g !== null)
    .map((g) => (NEAR_FIELD_ONLY.includes(g.detail.layerId) ? { ...g, nearField: true } : g))
}

/** Draws `base` under `layer`'s transparent pixels; false if the canvas refused. */
export type DrawBaseUnder = (layer: HTMLCanvasElement, base: HTMLCanvasElement) => boolean

/** Paints the neutral colour under whatever is still transparent in `layer`. */
export type FillNoData = (layer: HTMLCanvasElement) => void

/**
 * The layer with the base map under its gaps, and `base` saying so; or the
 * layer as it came with `base` saying why not: it is the base itself, the
 * base is not ready or failed (its reason is carried through), or
 * the canvas refused. Either way, whatever is still transparent afterwards
 * (gaps the base could not cover, or every gap when it was not drawn) is
 * then painted the neutral colour, so the canvas the store takes is final
 * and the scene only shows it; in a "why not" case the caption
 * prints the reason.
 */
export function withBaseUnder(
  layer: SurfaceImage,
  base: SurfaceImage | null,
  draw: DrawBaseUnder = drawGreyBaseUnder,
  fill: FillNoData = fillNoDataUnder,
): SurfaceImage {
  if (layer.status !== 'ready') return layer
  const status: SurfaceBase =
    layer.layerId === BASE_LAYER_ID ? { status: 'not-needed' } : baseStatus(base, layer.image, draw)
  fill(layer.image)
  return { ...layer, base: status }
}

function baseStatus(
  base: SurfaceImage | null,
  layerImage: HTMLCanvasElement,
  draw: DrawBaseUnder,
): SurfaceBase {
  const unavailable = (reason: string): SurfaceBase => ({ status: 'unavailable', reason })
  if (base === null) return unavailable('Base map not loaded')
  if (base.status === 'loading') return unavailable('Base map still loading')
  if (base.status === 'unavailable') return unavailable(`Base map unavailable: ${base.reason}`)
  if (base.layerId !== BASE_LAYER_ID) return unavailable(`Base map is ${base.layerId}, not ${BASE_LAYER_ID}`)
  if (!draw(layerImage, base.image)) return unavailable('Canvas could not draw the base map')
  return { status: 'drawn', layerId: base.layerId }
}

/**
 * The neutral colour under the layer's remaining transparent pixels.
 * `destination-over` leaves every opaque pixel alone, so painting it after
 * the base, or again, changes nothing already drawn. A canvas that refuses
 * a 2D context is left as it is.
 */
export function fillNoDataUnder(layer: HTMLCanvasElement): void {
  const ctx = layer.getContext('2d')
  if (!ctx) return
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = NO_DATA_CSS
  ctx.fillRect(0, 0, layer.width, layer.height)
  ctx.globalCompositeOperation = 'source-over'
}

/** Brightness of the base under a data layer: dark enough to read as "not data". */
const BASE_DIM = '#808080'

/**
 * The base under a TES grid layer's gaps: greyscale, not dimmed.
 * The grid ramps end in dark navy and dark red, so the half-brightness base
 * (about 50 of 255 on screen) read as black, or as a value past the scale;
 * at full brightness it reads as grey ground, as the legend says.
 */
const GRID_BASE_DIM = '#ffffff'

/** `drawGreyBaseUnder` at the grid layers' brightness. */
export const drawGridBaseUnder: DrawBaseUnder = (layer, base) => drawGreyBaseUnder(layer, base, GRID_BASE_DIM)

/**
 * The grey base alone, for the globe while a grid layer computes its first
 * picture, so the map is not the near-black no-data colour for the
 * model's run. null when the base is not ready or the canvas refuses.
 */
export function greyBasePicture(base: SurfaceImage | null, draw: DrawBaseUnder = drawGridBaseUnder): HTMLCanvasElement | null {
  if (base === null || base.status !== 'ready') return null
  const out = document.createElement('canvas')
  out.width = base.image.width
  out.height = base.image.height
  return draw(out, base.image) ? out : null
}

/**
 * How much of a thermal grid layer's colour covers the ground. At
 * the closest zoom an opaque grid hid the crater and the walker's place
 * under a few 30 km blocks. 0.6 keeps the colour the larger part of every
 * pixel and keeps its hue, while the grey ground's light and dark (the
 * crater's rim, floor and delta) shows through; above about two thirds the
 * rim is lost again. The cost: the shade now depends on the ground under it
 * too, up to about two legend steps between the darkest and brightest
 * ground (the ramps are single-hue, so shade is the value), which the
 * caption says.
 */
export const GRID_OVERLAY_ALPHA = 0.6

/**
 * A thermal grid layer laid partly see-through over the grey base:
 * `drape.under` is the grey base alone, `drape.over` the grid at
 * `alpha` with its no-data cells still clear, and `image` (the same
 * canvas the layer came in) the two composed, for the overhead map and the
 * surface view. Without a ready base, or when a canvas refuses, the grid
 * stays opaque with the base under its gaps as before (`withBaseUnder`):
 * fading it over the near-black no-data colour would darken every value.
 */
export function drapeGrid(
  layer: SurfaceImage,
  base: SurfaceImage | null,
  draw: DrawBaseUnder = drawGridBaseUnder,
  alpha: number = GRID_OVERLAY_ALPHA,
): SurfaceImage {
  if (layer.status !== 'ready' || base?.status !== 'ready') return withBaseUnder(layer, base, draw)
  const under = greyBasePicture(base, draw)
  const over = fadedCopy(layer.image, alpha)
  const ctx = layer.image.getContext('2d')
  if (under === null || over === null || !ctx) return withBaseUnder(layer, base, draw)
  const { width, height } = layer.image
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(under, 0, 0, width, height)
  ctx.drawImage(over, 0, 0)
  return { ...layer, base: { status: 'drawn', layerId: base.layerId }, drape: { under, over } }
}

/** A copy of `image` at `alpha` opacity; transparent pixels stay transparent. null when the canvas refuses. */
function fadedCopy(image: HTMLCanvasElement, alpha: number): HTMLCanvasElement | null {
  const out = document.createElement('canvas')
  out.width = image.width
  out.height = image.height
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.globalAlpha = alpha
  ctx.drawImage(image, 0, 0)
  ctx.globalAlpha = 1
  return out
}

/**
 * Greyscale, half-brightness base under the layer's transparent pixels
 * (`dim` sets the brightness; the grid layers pass white).
 * Blend modes rather than ctx.filter, which not every browser supports:
 * a grey fill in `saturation` mode removes the colour, a grey fill in
 * `multiply` halves the brightness, and `destination-over` puts the result
 * only where the layer is transparent. The base is scaled to the layer's
 * size, which differs for a layer served at a coarser zoom.
 */
export function drawGreyBaseUnder(layer: HTMLCanvasElement, base: HTMLCanvasElement, dim: string = BASE_DIM): boolean {
  const ctx = layer.getContext('2d')
  const grey = document.createElement('canvas')
  grey.width = layer.width
  grey.height = layer.height
  const g = grey.getContext('2d')
  if (!ctx || !g) return false
  g.drawImage(base, 0, 0, grey.width, grey.height)
  g.globalCompositeOperation = 'saturation'
  g.fillStyle = '#808080'
  g.fillRect(0, 0, grey.width, grey.height)
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = dim
  g.fillRect(0, 0, grey.width, grey.height)
  ctx.globalCompositeOperation = 'destination-over'
  ctx.drawImage(grey, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return true
}

/**
 * The adapter's `servedResolution` describes the finest zoom the service
 * has; what is on screen is the zoom actually fetched, so recompute for it.
 * Both are the same DERIVED formula from the adapter.
 */
function servedResolutionFor(zoom: number, result: Extract<LayerLoadResult, { status: 'available' }>) {
  return zoom === result.source.maxZoom ? result.servedResolution : servedResolution(zoom)
}
