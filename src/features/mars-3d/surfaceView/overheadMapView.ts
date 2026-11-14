import type { MarsCoordinate } from '../../../domain'
import { tileBounds, type TileIndex } from '../tilePyramid'

/**
 * View maths for the overhead map, small or expanded: a flat, north-up map of
 * the whole planet in Trek's equirectangular grid (2^(z+1) × 2^z tiles at
 * zoom z, the left edge at 180°W, the top at 90°N). The grid is linear in
 * degrees, so a screen point maps to a coordinate exactly, with no
 * projection maths beyond a scale and an offset. Pure, so it is tested
 * without a DOM.
 */

export const TILE_PX = 256

export interface MapView {
  /** The coordinate at the window's centre; longitude 0–360°E. */
  centre: MarsCoordinate
  /** Screen pixels per degree, the same on both axes. */
  pxPerDeg: number
}

export interface MapSize {
  width: number
  height: number
}

/** Pixels per degree of a tile at `zoom`. */
export function tilePxPerDeg(zoom: number): number {
  return (2 ** (zoom + 1) * TILE_PX) / 360
}

/**
 * Zoom out until the whole planet fits; zoom in to twice the finest tiles,
 * or until the window spans `minSpanDeg`, whichever is closer: the ground's
 * own picture is finer than a coarse layer's tiles.
 */
export function zoomLimits(size: MapSize, maxZoom: number, minSpanDeg = 0): { min: number; max: number } {
  const min = Math.min(size.width / 360, size.height / 180)
  const closest = minSpanDeg > 0 ? size.width / minSpanDeg : 0
  return { min, max: Math.max(min, tilePxPerDeg(maxZoom) * 2, closest) }
}

export function wrapLongitude(lon: number): number {
  return ((lon % 360) + 360) % 360
}

const clampLatitude = (lat: number) => Math.max(-90, Math.min(90, lat))

/** The coordinate under a point in the window, `x` and `y` from its top left. */
export function screenToCoordinate(view: MapView, size: MapSize, x: number, y: number): MarsCoordinate {
  return {
    latitude: clampLatitude(view.centre.latitude - (y - size.height / 2) / view.pxPerDeg),
    longitudeEast: wrapLongitude(view.centre.longitudeEast + (x - size.width / 2) / view.pxPerDeg),
  }
}

/**
 * Where a coordinate falls in the window, taking the copy of its longitude
 * nearest the centre, so a point across 180° from the centre is drawn on
 * the near side.
 */
export function coordinateToScreen(view: MapView, size: MapSize, at: MarsCoordinate): { x: number; y: number } {
  let dLon = wrapLongitude(at.longitudeEast - view.centre.longitudeEast)
  if (dLon > 180) dLon -= 360
  return {
    x: size.width / 2 + dLon * view.pxPerDeg,
    y: size.height / 2 - (at.latitude - view.centre.latitude) * view.pxPerDeg,
  }
}

/** The view dragged by `dx`, `dy` screen pixels: the map follows the pointer. */
export function panBy(view: MapView, dx: number, dy: number): MapView {
  return {
    pxPerDeg: view.pxPerDeg,
    centre: {
      latitude: clampLatitude(view.centre.latitude + dy / view.pxPerDeg),
      longitudeEast: wrapLongitude(view.centre.longitudeEast - dx / view.pxPerDeg),
    },
  }
}

/**
 * The view that keeps the walker in sight while it follows them:
 * the walker moves freely within `keep` of the window's width and height
 * from the centre, and the view shifts only enough to hold them at that
 * edge. Off the window entirely, a teleport, it re-centres on them.
 * Returns `view` itself when nothing needs to move.
 */
export function followWalker(view: MapView, size: MapSize, walker: MarsCoordinate, keep = 0.3): MapView {
  const at = coordinateToScreen(view, size, walker)
  if (at.x < 0 || at.x > size.width || at.y < 0 || at.y > size.height) return { ...view, centre: walker }
  const beyond = (offset: number, half: number) => Math.sign(offset) * Math.max(0, Math.abs(offset) - half)
  const ex = beyond(at.x - size.width / 2, size.width * keep)
  const ey = beyond(at.y - size.height / 2, size.height * keep)
  return ex === 0 && ey === 0 ? view : panBy(view, -ex, -ey)
}

/**
 * The view zoomed by `factor` about a point in the window, so the ground
 * under the cursor stays under it. The scale is clamped to `limits`.
 */
export function zoomAt(
  view: MapView,
  size: MapSize,
  x: number,
  y: number,
  factor: number,
  limits: { min: number; max: number },
): MapView {
  const pxPerDeg = Math.max(limits.min, Math.min(limits.max, view.pxPerDeg * factor))
  if (pxPerDeg === view.pxPerDeg) return view
  // Unclamped, so zooming near a pole keeps the cursor's latitude fixed too.
  const lat = view.centre.latitude - (y - size.height / 2) / view.pxPerDeg
  const lon = view.centre.longitudeEast + (x - size.width / 2) / view.pxPerDeg
  return {
    pxPerDeg,
    centre: {
      latitude: clampLatitude(lat + (y - size.height / 2) / pxPerDeg),
      longitudeEast: wrapLongitude(lon - (x - size.width / 2) / pxPerDeg),
    },
  }
}

/**
 * The coarsest tile zoom at least as fine as the screen (`pxPerDeg` times
 * the device pixel ratio), capped at `maxZoom`. Null when `baseZoom`, the
 * whole-globe image's, is already fine enough; with no image (null), tiles
 * from zoom 0 are always wanted.
 */
export function tileZoomFor(pxPerDeg: number, dpr: number, baseZoom: number | null, maxZoom: number): number | null {
  const want = pxPerDeg * dpr
  let zoom = baseZoom === null ? 0 : baseZoom + 1
  if (baseZoom !== null && tilePxPerDeg(baseZoom) >= want) return null
  while (zoom < maxZoom && tilePxPerDeg(zoom) < want) zoom++
  return zoom <= maxZoom ? zoom : null
}

/** Tile pixels may be up to this much larger than device pixels, as on the globe (`tilePyramid.ts`). */
export const MAP_SLACK = 1.5
/** Never more tiles in view than this, below the map's cache of 192, so every wanted tile can stay. */
export const MAX_MAP_TILES = 160

/**
 * The tiles to draw for a view: the zoom from `tileZoomFor` with the
 * slack, then coarser until they fit MAX_MAP_TILES, as the globe does. A
 * large window on a dense display would otherwise ask for hundreds. Null
 * when the whole-globe image is fine enough, or nothing finer fits.
 */
export function tilesForMap(
  view: MapView,
  size: MapSize,
  dpr: number,
  baseZoom: number | null,
  maxZoom: number,
): { zoom: number; tiles: TileIndex[] } | null {
  let zoom = tileZoomFor(view.pxPerDeg, dpr / MAP_SLACK, baseZoom, maxZoom)
  const floor = baseZoom === null ? 0 : baseZoom + 1
  while (zoom !== null && zoom >= floor) {
    const tiles = visibleTiles(view, size, zoom)
    if (tiles.length <= MAX_MAP_TILES) return { zoom, tiles }
    zoom--
  }
  return null
}

/**
 * The tiles at `zoom` that cover the window, nearest the centre first.
 * Columns wrap round 180°, so each appears once even when the window shows
 * the same longitude twice. Rows stop at the poles.
 */
export function visibleTiles(view: MapView, size: MapSize, zoom: number): TileIndex[] {
  const rows = 2 ** zoom
  const cols = rows * 2
  const span = 180 / rows
  const halfW = size.width / 2 / view.pxPerDeg
  const halfH = size.height / 2 / view.pxPerDeg
  // Degrees east of 180°W, unwrapped, so the window's span is one interval.
  const fromWest = (lon: number) => lon - 180
  const left = fromWest(view.centre.longitudeEast) - halfW
  const right = fromWest(view.centre.longitudeEast) + halfW
  const top = Math.max(0, Math.floor((90 - (view.centre.latitude + halfH)) / span))
  const bottom = Math.min(rows - 1, Math.floor((90 - (view.centre.latitude - halfH)) / span))
  const firstCol = Math.floor(left / span)
  const lastCol = Math.min(Math.floor(right / span), firstCol + cols - 1)
  const centreRow = (90 - view.centre.latitude) / span
  const centreCol = fromWest(view.centre.longitudeEast) / span
  const found: { tile: TileIndex; d: number }[] = []
  for (let row = top; row <= bottom; row++) {
    for (let k = firstCol; k <= lastCol; k++) {
      const col = ((k % cols) + cols) % cols
      found.push({ tile: { zoom, row, col }, d: Math.hypot(row + 0.5 - centreRow, k + 0.5 - centreCol) })
    }
  }
  return found.sort((a, b) => a.d - b.d).map((f) => f.tile)
}

/**
 * Where to draw a tile, or an image covering `bounds`, in the window: one
 * rectangle per copy of its longitude that the window shows.
 */
export function placements(
  view: MapView,
  size: MapSize,
  bounds: ImageBounds,
): { x: number; y: number; w: number; h: number }[] {
  const w = bounds.width * view.pxPerDeg
  const h = (bounds.north - bounds.south) * view.pxPerDeg
  const y = size.height / 2 - (bounds.north - view.centre.latitude) * view.pxPerDeg
  // The copy nearest the centre, then its neighbours a planet's width away.
  let dLon = wrapLongitude(bounds.west - view.centre.longitudeEast)
  if (dLon > 180) dLon -= 360
  const x0 = size.width / 2 + dLon * view.pxPerDeg
  const planet = 360 * view.pxPerDeg
  const out: { x: number; y: number; w: number; h: number }[] = []
  for (let n = -2; n <= 2; n++) {
    const x = x0 + n * planet
    if (x + w > 0 && x < size.width && y + h > 0 && y < size.height) out.push({ x, y, w, h })
  }
  return out
}

export interface ImageBounds {
  north: number
  south: number
  /** Longitude of the west edge, 0–360°E. */
  west: number
  /** Width in degrees. */
  width: number
}

/** An image to lay on the map over the place it shows. */
export interface MapPicture {
  image: CanvasImageSource
  bounds: ImageBounds
}

/**
 * Where a ground patch's picture lies: its box is a plain latitude
 * and longitude box, west and east relative to `lon0` (`boxUv` in
 * `surfacePatch.ts` maps it linearly), so it sits on this grid exactly.
 */
export function patchBounds(
  box: { north: number; south: number; westRel: number; eastRel: number },
  lon0: number,
): ImageBounds {
  return { north: box.north, south: box.south, west: wrapLongitude(lon0 + box.westRel), width: box.eastRel - box.westRel }
}

/** The whole planet's bounds, for the whole-globe image. */
export const GLOBE_BOUNDS = { north: 90, south: -90, west: 180, width: 360 }

export function tilePlacements(view: MapView, size: MapSize, tile: TileIndex) {
  return placements(view, size, tileBounds(tile))
}

/** Decimal places for a coordinate picked at this scale: about one screen pixel. */
export function pickPrecision(pxPerDeg: number): number {
  return Math.max(1, Math.min(5, Math.ceil(Math.log10(pxPerDeg))))
}

/** The expanded window's share of the screen on each side when it opens. */
export const OPEN_SHARE = 0.3
/** Smallest the window can be dragged to, CSS px. */
export const MIN_WINDOW_PX = 240
/** Room kept free between the window and the screen edges, CSS px. */
export const SCREEN_MARGIN_PX = 32
/** The map panel's header, caption and padding around the canvas, CSS px, kept on screen too. */
export const PANEL_CHROME_PX = 160
/** The surface panel above keeps its title row and Back to orbit (`min-h-16` and the column gap), CSS px. */
export const SURFACE_PANEL_MIN_PX = 76
/** Kept free on the right for the time menu and the compass dial, CSS px. */
export const RIGHT_COLUMN_PX = 300
/** The canvas never shrinks below this to fit a tiny screen, CSS px. */
const FLOOR_PX = 120

/** The window's size, kept between the minimum and the screen less its margins. */
export function clampWindowSize(size: MapSize, screen: MapSize): MapSize {
  const clamp = (v: number, room: number) => {
    const r = Math.max(FLOOR_PX, room)
    return Math.round(Math.max(Math.min(MIN_WINDOW_PX, r), Math.min(r, v)))
  }
  return {
    width: clamp(size.width, screen.width - 2 * SCREEN_MARGIN_PX - RIGHT_COLUMN_PX),
    height: clamp(size.height, screen.height - 2 * SCREEN_MARGIN_PX - PANEL_CHROME_PX - SURFACE_PANEL_MIN_PX),
  }
}

/** The size the window opens at: about 30% of the screen each way. */
export function openWindowSize(screen: MapSize): MapSize {
  return clampWindowSize({ width: screen.width * OPEN_SHARE, height: screen.height * OPEN_SHARE }, screen)
}
