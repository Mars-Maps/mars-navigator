import type { MarsCoordinate } from '../../domain'

/**
 * Which detail tiles to show. Pure maths over Trek's equirectangular
 * grid, which the scene is allowed to know as geometry: 2^(z+1) × 2^z tiles
 * at zoom z, the left edge at 180°W (= 180°E), the top at 90°N. The scene
 * never builds a URL; it asks the shell's loader by index.
 */

export interface TileIndex {
  zoom: number
  row: number
  col: number
}

/**
 * Degrees. Column edges fall on multiples of the tile span from 180°E, and
 * 360 is a multiple of every span, so no tile straddles 0°E.
 */
export interface TileBounds {
  north: number
  south: number
  /** Longitude of the west edge, 0–360°E. */
  west: number
  /** Width in degrees; the east edge is west + width, wrapping past 360. */
  width: number
}

/** The whole-globe image's zoom; detail starts one level finer. */
export const BASE_ZOOM = 2
/** Tile pixels may be up to this much larger than screen pixels before going finer. */
const SLACK = 1.5
const TILE_PX = 256
/** Never more than this many tiles in view; if a zoom needs more, use the coarser one. */
export const MAX_VISIBLE_TILES = 300

const RAD = Math.PI / 180

export function tileKey(t: TileIndex): string {
  return `${t.zoom}/${t.row}/${t.col}`
}

export function tileBounds(t: TileIndex): TileBounds {
  const rows = 2 ** t.zoom
  const span = 180 / rows
  const north = 90 - t.row * span
  // Column 0 starts at 180°W, which is 180°E in the project convention.
  const west = (180 + t.col * span) % 360
  return { north, south: north - span, west, width: span }
}

/** Ground metres per screen pixel at the view centre, looking straight down. */
export function groundMetresPerPixel(altitudeKm: number, fovDeg: number, heightPx: number): number {
  return (2 * altitudeKm * 1000 * Math.tan((fovDeg / 2) * RAD)) / heightPx
}

/** Ground metres per tile pixel at the equator at `zoom`, for tiles `tilePx` wide (Trek's 256 by default). */
export function tileMetresPerPixel(zoom: number, radiusKm: number, tilePx: number = TILE_PX): number {
  return (2 * Math.PI * radiusKm * 1000) / (2 ** (zoom + 1) * tilePx)
}

/**
 * The zoom whose tiles are at least about as fine as the screen, within
 * SLACK, capped at the source's maximum. null when the whole-globe image
 * is already fine enough (zoom ≤ BASE_ZOOM) or the source has nothing
 * finer than it.
 */
export function zoomForView(
  altitudeKm: number,
  fovDeg: number,
  heightPx: number,
  maxZoom: number,
  radiusKm: number,
  tilePx: number = TILE_PX,
): number | null {
  if (!(altitudeKm > 0) || !(heightPx > 0) || maxZoom <= BASE_ZOOM) return null
  const want = groundMetresPerPixel(altitudeKm, fovDeg, heightPx) * SLACK
  let zoom = BASE_ZOOM
  while (zoom < maxZoom && tileMetresPerPixel(zoom, radiusKm, tilePx) > want) zoom++
  return zoom > BASE_ZOOM ? zoom : null
}

/** Extra reach on the screen's corner angle, so tiles at the very corner are in. */
const CAP_MARGIN = 1.1

/**
 * Angular radius, radians, of the ground the camera can see around the view
 * centre: the horizon from this altitude, or the ground under the screen's
 * corner when that is nearer. Exact for the nadir camera: the corner ray
 * leaves the camera `a` off the vertical and meets the sphere where
 * sin(a + γ) = (R + h) / R · sin a. The small-angle estimate used before
 * fell short from about 3,500 km up with the 25° lens, so the corners and
 * the limb kept the whole-globe image.
 */
export function visibleCapRadians(
  altitudeKm: number,
  fovDeg: number,
  aspect: number,
  radiusKm: number,
): number {
  const horizon = Math.acos(radiusKm / (radiusKm + altitudeKm))
  const corner = Math.atan(Math.tan((fovDeg / 2) * RAD) * Math.sqrt(1 + aspect * aspect))
  const s = ((radiusKm + altitudeKm) / radiusKm) * Math.sin(corner)
  // The corner ray misses the sphere: the limb is on screen.
  if (s >= 1) return horizon
  return Math.min(horizon, (Math.asin(s) - corner) * CAP_MARGIN)
}

/** Great-circle angle, radians, between two surface coordinates. */
export function angleBetween(a: MarsCoordinate, b: MarsCoordinate): number {
  const la = a.latitude * RAD
  const lb = b.latitude * RAD
  const dl = (a.longitudeEast - b.longitudeEast) * RAD
  const cos = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dl)
  return Math.acos(Math.min(1, Math.max(-1, cos)))
}

/**
 * Tiles at `zoom` within `capRad` of `centre`, nearest first. A tile is in
 * when its centre is within the cap plus the tile's own half-diagonal, so
 * every tile that touches the cap is included. Empty when the zoom would
 * need more than MAX_VISIBLE_TILES, so the caller falls back to a coarser
 * zoom rather than flooding the loader.
 */
export function visibleTiles(zoom: number, centre: MarsCoordinate, capRad: number): TileIndex[] {
  const rows = 2 ** zoom
  const cols = 2 * rows
  const span = 180 / rows
  const halfSpan = (span / 2) * RAD
  const out: { tile: TileIndex; distance: number }[] = []
  // Only rows whose latitude band can reach the cap.
  const latReach = (capRad + halfSpan * Math.SQRT2) / RAD
  for (let row = 0; row < rows; row++) {
    const north = 90 - row * span
    const south = north - span
    if (south > centre.latitude + latReach || north < centre.latitude - latReach) continue
    const latC = (north + south) / 2
    const halfDiagonal = Math.hypot(halfSpan, halfSpan * Math.cos(latC * RAD))
    for (let col = 0; col < cols; col++) {
      const lonC = (180 + col * span + span / 2) % 360
      const distance = angleBetween(centre, { latitude: latC, longitudeEast: lonC })
      if (distance <= capRad + halfDiagonal) {
        out.push({ tile: { zoom, row, col }, distance })
        if (out.length > MAX_VISIBLE_TILES) return []
      }
    }
  }
  out.sort((a, b) => a.distance - b.distance)
  return out.map((o) => o.tile)
}

/**
 * The tiles to show for a settled view: the finest zoom the altitude asks
 * for whose visible set fits the cap, or none.
 *
 * `tilePx` is the source's tile width (the global CTX mosaic serves 512).
 * `finerThan` makes this a source that only fills in where another runs out:
 * none while that source's finest zoom, `finerThan.maxZoom` with
 * `finerThan.tilePx` tiles, is still as fine as the screen asks.
 */
export function tilesForView(
  view: { altitudeKm: number; target: MarsCoordinate },
  screen: { fovDeg: number; heightPx: number; aspect: number },
  maxZoom: number,
  radiusKm: number,
  options: { tilePx?: number; finerThan?: { maxZoom: number; tilePx?: number } } = {},
): { zoom: number; tiles: TileIndex[] } | null {
  const { finerThan } = options
  if (finerThan) {
    const want = groundMetresPerPixel(view.altitudeKm, screen.fovDeg, screen.heightPx) * SLACK
    if (!(tileMetresPerPixel(finerThan.maxZoom, radiusKm, finerThan.tilePx) > want)) return null
  }
  let zoom = zoomForView(view.altitudeKm, screen.fovDeg, screen.heightPx, maxZoom, radiusKm, options.tilePx)
  if (zoom === null) return null
  const cap = visibleCapRadians(view.altitudeKm, screen.fovDeg, screen.aspect, radiusKm)
  while (zoom > BASE_ZOOM) {
    const tiles = visibleTiles(zoom, view.target, cap)
    if (tiles.length > 0) return { zoom, tiles }
    zoom--
  }
  return null
}
