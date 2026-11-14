import type { MarsCoordinate } from '../../../domain'
import type { GroundImagery } from '../surfaceDetail'
import { tileBounds, type TileBounds, type TileIndex } from '../tilePyramid'
import { toPatch, type PatchFrame } from './surfacePatch'

/**
 * Geometry of the near-field ground image: a block of the finest
 * mosaic's tiles around the walker, drawn into the ground shader on top of
 * the 40 km patch. Pure arithmetic over Trek's grid (2^(z+1) × 2^z tiles
 * from 180°E, 90°N), so it is tested without a canvas or a GPU.
 */

/** Tiles per side of the block: 8 × 256 px at zoom 17 is about 650 m of ground at 0.32 m/px. */
export const NEAR_TILES = 8
/** Past this distance from the block's centre, the block is moved to centre on the walker. */
export const NEAR_RECENTRE_M = 150

/** An n × n block of tiles at one zoom: its top-left tile, and the box it covers. */
export interface NearBlock {
  zoom: number
  row0: number
  col0: number
  n: number
  /** West may run past 360 when the block crosses 180°E: the box is one piece. */
  bounds: TileBounds
}

/** The n × n block at `zoom` whose centre is nearest `at`, kept inside the grid's rows. */
export function nearBlock(at: MarsCoordinate, zoom: number, n = NEAR_TILES): NearBlock {
  const rows = 2 ** zoom
  const columns = 2 * rows
  const span = 180 / rows
  const row0 = Math.max(0, Math.min(rows - n, Math.round((90 - at.latitude) / span - n / 2)))
  const fromWest = ((((at.longitudeEast - 180) % 360) + 360) % 360) / span
  const col0 = (((Math.round(fromWest - n / 2) % columns) + columns) % columns)
  const first = tileBounds({ zoom, row: row0, col: col0 })
  return {
    zoom,
    row0,
    col0,
    n,
    bounds: { north: first.north, south: first.north - n * span, west: first.west, width: n * span },
  }
}

export function sameBlock(a: NearBlock | null, b: NearBlock): boolean {
  return a !== null && a.zoom === b.zoom && a.row0 === b.row0 && a.col0 === b.col0 && a.n === b.n
}

/** A tile of the block and where it sits in the block's image, in tiles from the top-left. */
export interface BlockTile {
  tile: TileIndex
  x: number
  y: number
}

/**
 * The block's tiles that meet `coverage` (the mosaic answers 404 elsewhere),
 * nearest `at` first so the ground underfoot arrives first.
 */
export function blockTiles(block: NearBlock, coverage: GroundImagery['coverage'], at: MarsCoordinate): BlockTile[] {
  const columns = 2 ** (block.zoom + 1)
  const span = block.bounds.width / block.n
  const out: (BlockTile & { d: number })[] = []
  for (let y = 0; y < block.n; y++) {
    for (let x = 0; x < block.n; x++) {
      const tile = { zoom: block.zoom, row: block.row0 + y, col: (block.col0 + x) % columns }
      const t = tileBounds(tile)
      if (coverage && !meets(t, coverage)) continue
      const dLat = t.north - span / 2 - at.latitude
      const dLon = relative(t.west + span / 2 - at.longitudeEast) * Math.cos((at.latitude * Math.PI) / 180)
      out.push({ tile, x, y, d: Math.hypot(dLat, dLon) })
    }
  }
  return out.sort((a, b) => a.d - b.d).map(({ tile, x, y }) => ({ tile, x, y }))
}

/** True when the block meets `coverage` at all; null coverage is the whole planet. */
export function blockMeets(block: NearBlock, coverage: GroundImagery['coverage']): boolean {
  return coverage === null || meets(block.bounds, coverage)
}

function meets(t: TileBounds, c: NonNullable<GroundImagery['coverage']>): boolean {
  if (t.south >= c.north || t.north <= c.south) return false
  // Compare on the turn of the box's centre, so either may be written past 360 or below 0.
  const shift = relative(c.west - t.west) - (c.west - t.west)
  return t.west < c.east + shift && t.west + t.width > c.west + shift
}

/** Degrees in (−180, 180]. */
function relative(d: number): number {
  const r = (((d % 360) + 360) % 360)
  return r > 180 ? r - 360 : r
}

/**
 * Where block `next`'s image takes block `prev`'s pixels from: `next`'s
 * top-left tile in `prev`'s tiles. Same zoom only; null otherwise, or when
 * they share no tile.
 */
export function blockShift(prev: NearBlock, next: NearBlock): { dx: number; dy: number } | null {
  if (prev.zoom !== next.zoom || prev.n !== next.n) return null
  const columns = 2 ** (next.zoom + 1)
  const dy = next.row0 - prev.row0
  let dx = (next.col0 - prev.col0) % columns
  if (dx > columns / 2) dx -= columns
  if (dx < -columns / 2) dx += columns
  return Math.abs(dx) < next.n && Math.abs(dy) < next.n ? { dx, dy } : null
}

/**
 * The block image's texture coordinates as an affine function of the
 * patch's metres (x east, y north): u = U·(x, y, 1) from the west edge, v =
 * V·(x, y, 1) from the south edge, as the texture is uploaded flipped. Fitted
 * at the block's centre: over a few hundred metres the azimuthal patch and
 * the equirectangular block differ from affine by about a centimetre at the
 * block's corners, a few percent of a 0.32 m pixel. `centre` is
 * the block's centre in patch metres, for the recentre test.
 */
export interface NearUvMap {
  u: [number, number, number]
  v: [number, number, number]
  centre: { xM: number; yM: number }
}

export function nearUvMap(frame: PatchFrame, bounds: TileBounds): NearUvMap {
  const lat = bounds.north - (bounds.north - bounds.south) / 2
  const lon = bounds.west + bounds.width / 2
  const d = (bounds.north - bounds.south) / 4
  const o = toPatch(frame, { latitude: lat, longitudeEast: lon })
  const e = toPatch(frame, { latitude: lat, longitudeEast: lon + d })
  const n = toPatch(frame, { latitude: lat + d, longitudeEast: lon })
  // Metres per degree: columns are d/dlon and d/dlat of (x, y).
  const a = ((e.xKm - o.xKm) * 1000) / d
  const b = ((n.xKm - o.xKm) * 1000) / d
  const c = ((e.yKm - o.yKm) * 1000) / d
  const dd = ((n.yKm - o.yKm) * 1000) / d
  const det = a * dd - b * c
  // Degrees per metre, the inverse.
  const lonX = dd / det
  const lonY = -b / det
  const latX = -c / det
  const latY = a / det
  const x0 = o.xKm * 1000
  const y0 = o.yKm * 1000
  const w = bounds.width
  const h = bounds.north - bounds.south
  return {
    u: [lonX / w, lonY / w, 0.5 - (lonX * x0 + lonY * y0) / w],
    v: [latX / h, latY / h, 0.5 - (latX * x0 + latY * y0) / h],
    centre: { xM: x0, yM: y0 },
  }
}
