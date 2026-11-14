import { NO_DATA_CSS } from '../../../state'
import type { GroundImagery, SurfaceDetail } from '../surfaceDetail'
import { tileBounds, type TileIndex } from '../tilePyramid'
import type { PatchBox } from './surfacePatch'

/** Pixels per side of the draped image: 39 m each over 40 km, finer than any layer's tiles. */
const PATCH_IMAGE_PX = 1024
/**
 * With ground imagery: 20 m per pixel, which is its tiles' resolution
 * at zoom 10 on the equator (finer poleward), so no finer zoom is asked for.
 */
const GROUND_IMAGE_PX = 2048
const MAX_GROUND_ZOOM = 10
/** Finest layer zoom asked for, and the most tiles one patch may load of each kind. */
const MAX_PATCH_ZOOM = 9
const MAX_PATCH_TILES = 36
/**
 * 512 px ground tiles: 40 is a 40 km box at zoom 10 up to about 50° latitude,
 * zoom 9 beyond. `groundLimits` scales both for other tile sizes.
 */
const MAX_GROUND_TILES = 40

/**
 * The finest zoom and the tile budget for ground tiles of `tilePx`:
 * 256 px tiles reach the same 20 m at one zoom finer than 512 px ones, and
 * get four times the tiles for the same pixels.
 */
export function groundLimits(tilePx: number): { maxZoom: number; maxTiles: number } {
  const scale = 512 / tilePx
  return { maxZoom: MAX_GROUND_ZOOM + Math.round(Math.log2(scale)), maxTiles: Math.round(MAX_GROUND_TILES * scale * scale) }
}

/**
 * The part of `box` a mosaic covers, in the box's own terms, or null when
 * they do not meet. `coverage` null is the whole planet. Its
 * longitudes may be on any turn: they are shifted to the one nearest
 * `lon0`.
 */
export function clipBox(box: PatchBox, lon0: number, coverage: GroundImagery['coverage']): PatchBox | null {
  if (coverage === null) return box
  const shift = Math.round((lon0 - (coverage.west + coverage.east) / 2) / 360) * 360
  const clipped = {
    south: Math.max(box.south, coverage.south),
    north: Math.min(box.north, coverage.north),
    westRel: Math.max(box.westRel, coverage.west + shift - lon0),
    eastRel: Math.min(box.eastRel, coverage.east + shift - lon0),
  }
  return clipped.south < clipped.north && clipped.westRel < clipped.eastRel ? clipped : null
}

/**
 * An equirectangular source image: its west edge (°E, may exceed 360 or go
 * below 0), width in degrees, and north and south edges.
 */
export interface EquirectSource {
  west: number
  width: number
  north: number
  south: number
  pxWidth: number
  pxHeight: number
}

export interface DrawPiece {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

/**
 * Where `src` lands in a `size` × `sizeY`-pixel image of `box` (longitudes
 * relative to `lon0`): one piece per copy of the source shifted by whole
 * turns that overlaps the box, so a box across 180°E or one spanning every
 * longitude still gets every pixel.
 */
export function equirectPieces(src: EquirectSource, box: PatchBox, lon0: number, size: number, sizeY = size): DrawPiece[] {
  const a = lon0 + box.westRel
  const b = lon0 + box.eastRel
  const top = Math.min(box.north, src.north)
  const bottom = Math.max(box.south, src.south)
  if (top <= bottom || b <= a) return []
  const pieces: DrawPiece[] = []
  for (let k = -2; k <= 2; k++) {
    const left = src.west + 360 * k
    const lo = Math.max(a, left)
    const hi = Math.min(b, left + src.width)
    if (hi <= lo) continue
    pieces.push({
      sx: ((lo - left) / src.width) * src.pxWidth,
      sy: ((src.north - top) / (src.north - src.south)) * src.pxHeight,
      sw: ((hi - lo) / src.width) * src.pxWidth,
      sh: ((top - bottom) / (src.north - src.south)) * src.pxHeight,
      dx: ((lo - a) / (b - a)) * size,
      dy: ((box.north - top) / (box.north - box.south)) * sizeY,
      dw: ((hi - lo) / (b - a)) * size,
      dh: ((top - bottom) / (box.north - box.south)) * sizeY,
    })
  }
  return pieces
}

/** Trek tiles at `zoom` (2^(z+1) × 2^z grid from 180°E, 90°N) that touch the box. */
export function boxTiles(zoom: number, box: PatchBox, lon0: number): TileIndex[] {
  const span = 180 / 2 ** zoom
  const columns = 2 ** (zoom + 1)
  const rowOf = (lat: number) => Math.min(2 ** zoom - 1, Math.floor((90 - lat) / span))
  const colOf = (lon: number) => Math.floor(((((lon - 180) % 360) + 360) % 360) / span) % columns
  const cols = new Set<number>()
  const a = lon0 + box.westRel
  const b = lon0 + box.eastRel
  for (let lon = a; lon < b + span; lon += span) cols.add(colOf(Math.min(lon, b)))
  const tiles: TileIndex[] = []
  for (let row = rowOf(box.north); row <= rowOf(box.south); row++) {
    for (const col of cols) tiles.push({ zoom, row, col })
  }
  return tiles
}

/**
 * The finest zoom, from `maxZoom` down, whose tiles touching the box fit
 * the budget, with those tiles; never coarser than zoom 3, budget or not.
 */
export function pickZoom(
  maxZoom: number,
  box: PatchBox,
  lon0: number,
  maxTiles: number,
): { zoom: number; tiles: TileIndex[] } {
  let zoom = maxZoom
  let tiles = boxTiles(zoom, box, lon0)
  while (tiles.length > maxTiles && zoom > 3) tiles = boxTiles(--zoom, box, lon0)
  return { zoom, tiles }
}

/** A mosaic's brightness canvas and where it lies in the result, in result pixels. */
export interface LumLayer {
  image: CanvasImageSource
  x: number
  y: number
  w: number
  h: number
}

/**
 * The result pixels a mosaic's clipped `area` covers in a `size`-pixel image
 * of `box`, widened to whole pixels, and that rectangle's own lat/lon box:
 * a mosaic over part of the patch gets a canvas over that part only,
 * at the image's density and on its pixel grid, so composing copies it 1:1
 * and the result is the same as with a full-size canvas. That holds while a
 * mosaic's tiles are transparent outside its stated coverage, as the Jezero
 * mosaics' are (groundDetailSources.ts): pixels beyond it are cut here.
 */
export function areaPlacement(
  box: PatchBox,
  area: PatchBox,
  size: number,
): { x: number; y: number; w: number; h: number; box: PatchBox } {
  const across = box.eastRel - box.westRel
  const down = box.north - box.south
  const x0 = Math.max(0, Math.floor(((area.westRel - box.westRel) / across) * size))
  const x1 = Math.min(size, Math.max(x0 + 1, Math.ceil(((area.eastRel - box.westRel) / across) * size)))
  const y0 = Math.max(0, Math.floor(((box.north - area.north) / down) * size))
  const y1 = Math.min(size, Math.max(y0 + 1, Math.ceil(((box.north - area.south) / down) * size)))
  return {
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    box: {
      westRel: box.westRel + (x0 / size) * across,
      eastRel: box.westRel + (x1 / size) * across,
      north: box.north - (y0 / size) * down,
      south: box.north - (y1 / size) * down,
    },
  }
}

/**
 * Pan-sharpening (DERIVED): the layer's colour with the ground imagery's
 * brightness, through the canvas's `luminosity` blend. Each `lum` canvas,
 * coarsest first, sets the brightness where it has pixels, so a
 * finer mosaic wins inside its footprint; each is drawn over its own area.
 * A transparent pixel, where no ground tile has arrived or the
 * mosaic has no image, leaves what is under it, and the no-data colour
 * shows where nothing has anything.
 */
export function composePatch(
  ctx: CanvasRenderingContext2D,
  colour: CanvasImageSource,
  lum: readonly LumLayer[],
  size: number,
): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = NO_DATA_CSS
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(colour, 0, 0, size, size)
  ctx.globalCompositeOperation = 'luminosity'
  for (const l of lum) ctx.drawImage(l.image, l.x, l.y, l.w, l.h)
  ctx.globalCompositeOperation = 'source-over'
}

/** What tiles are drawn into: the result's own box and size, or a brightness canvas over its mosaic's area. */
interface Target {
  box: PatchBox
  w: number
  h: number
}

/** One ground mosaic's tiles over one patch, for the caption. */
export interface GroundTiles {
  imagery: GroundImagery
  zoom: number
  total: number
  /** Resolves, once every load has settled, with how many tiles drew. */
  loaded: Promise<number>
}

export interface PatchImage {
  canvas: HTMLCanvasElement
  /** One entry per ground mosaic drawn, coarsest first; empty without any, or when the canvas could not compose them. */
  ground: GroundTiles[]
}

/**
 * The real imagery under a patch as one equirectangular canvas over `box`,
 * north at the top: the whole-globe image the globe already shows, then
 * the finest layer tiles that fit the budget over it as they arrive. With
 * `ground` imagery the layer goes onto its own canvas, each ground
 * mosaic that touches the box onto one more, and the result is
 * composed from them, coarsest first, after each tile. `onUpdate` fires
 * whenever the result changes so the texture can be re-uploaded. Aborting
 * stops the loads; every bitmap is closed.
 */
export function drawPatchImage(
  box: PatchBox,
  lon0: number,
  globeImage: HTMLCanvasElement | null,
  detail: SurfaceDetail | null,
  ground: readonly GroundImagery[],
  signal: AbortSignal,
  onUpdate: () => void,
): PatchImage {
  const mosaics = ground.flatMap((imagery) => {
    // The near-field image draws these (useNearField).
    if (imagery.nearField) return []
    const area = clipBox(box, lon0, imagery.coverage)
    return area ? [{ imagery, area }] : []
  })
  const size = mosaics.length > 0 ? GROUND_IMAGE_PX : PATCH_IMAGE_PX
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { canvas, ground: [] }
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = NO_DATA_CSS
  ctx.fillRect(0, 0, size, size)

  // Without ground imagery the layer is drawn straight onto the result.
  const placements = mosaics.map(({ area }) => areaPlacement(box, area, size))
  const layers = mosaics.length > 0 ? groundCanvases(ctx, size, placements) : null
  const colourCtx = layers?.colour ?? ctx
  // Composing redraws the whole result, so tiles landing in one frame share it.
  let queued = false
  const update = layers
    ? () => {
        if (queued) return
        queued = true
        requestAnimationFrame(() => {
          queued = false
          // Disposed before the frame came: nobody shows this canvas now.
          if (signal.aborted) return
          layers.compose()
          onUpdate()
        })
      }
    : onUpdate

  const whole: Target = { box, w: size, h: size }
  const draw = (g: CanvasRenderingContext2D, image: CanvasImageSource, src: EquirectSource, to: Target = whole) => {
    for (const p of equirectPieces(src, to.box, lon0, to.w, to.h)) {
      g.drawImage(image, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh)
    }
  }
  if (globeImage) {
    draw(colourCtx, globeImage, {
      west: 180,
      width: 360,
      north: 90,
      south: -90,
      pxWidth: globeImage.width,
      pxHeight: globeImage.height,
    })
    layers?.compose()
  }

  /** Starts every tile load; each promise resolves 1 if the tile drew, else 0. */
  const load = (source: SurfaceDetail, g: CanvasRenderingContext2D, tiles: TileIndex[], to?: Target): Promise<number>[] =>
    tiles.map((tile) =>
      source.loadTile(tile.zoom, tile.row, tile.col, signal).then((result) => {
        if (result.status !== 'ready') return 0
        if (signal.aborted) {
          result.image.close()
          return 0
        }
        const t = tileBounds(tile)
        draw(g, result.image, {
          west: t.west,
          width: t.width,
          north: t.north,
          south: t.south,
          pxWidth: result.image.width,
          pxHeight: result.image.height,
        }, to)
        result.image.close()
        update()
        return 1
      }),
    )

  if (detail) {
    void load(detail, colourCtx, pickZoom(Math.min(detail.maxZoom, MAX_PATCH_ZOOM), box, lon0, MAX_PATCH_TILES).tiles)
  }
  if (!layers) return { canvas, ground: [] }
  return {
    canvas,
    ground: mosaics.map(({ imagery, area }, i) => {
      const limits = groundLimits(imagery.tilePx)
      // Only the tiles over the part of the box the mosaic covers.
      const { zoom, tiles } = pickZoom(Math.min(imagery.detail.maxZoom, limits.maxZoom), area, lon0, limits.maxTiles)
      const to = placements[i]
      const loaded = Promise.all(load(imagery.detail, layers.lum[i], tiles, to)).then((drew) =>
        drew.reduce((a, b) => a + b, 0),
      )
      return { imagery, zoom, total: tiles.length, loaded }
    }),
  }
}

function makeCanvas(width: number, height = width): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/**
 * The canvases pan-sharpening composes from, the colour and one per ground
 * mosaic over that mosaic's area only, and the composition onto
 * `ctx`; null when a context is refused, so the layer is drawn alone.
 */
function groundCanvases(
  ctx: CanvasRenderingContext2D,
  size: number,
  placements: readonly ReturnType<typeof areaPlacement>[],
): { colour: CanvasRenderingContext2D; lum: CanvasRenderingContext2D[]; compose: () => void } | null {
  const colourCanvas = makeCanvas(size)
  const colour = colourCanvas.getContext('2d')
  const lumCanvases = placements.map((p) => makeCanvas(p.w, p.h))
  const lum = lumCanvases.map((c) => c.getContext('2d')).filter((g) => g !== null)
  if (!colour || lum.length !== placements.length) return null
  colour.imageSmoothingQuality = 'high'
  for (const g of lum) g.imageSmoothingQuality = 'high'
  const layers = lumCanvases.map((image, i) => ({ image, ...placements[i] }))
  return { colour, lum, compose: () => composePatch(ctx, colourCanvas, layers, size) }
}
