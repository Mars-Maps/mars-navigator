import type { Classified } from '../../domain'

/**
 * How the scene gets detail tiles for the active layer. The app
 * shell builds one of these from the layer adapter and passes it to
 * MarsGlobe as a prop, so the scene can ask for a tile by grid index and
 * never learns where tiles come from.
 */
export type SurfaceTileResult =
  | { status: 'ready'; image: ImageBitmap }
  /** The product has no data in this row: nothing to draw, not a failure. */
  | { status: 'empty' }
  /** `retryable`: asking again may succeed (network, server); false for a wrong or missing tile. */
  | { status: 'error'; reason: string; retryable: boolean }

export interface SurfaceDetail {
  /** The layer's id, or the ground-detail source's. */
  layerId: string
  /** Finest zoom the source serves; the scene never asks past it. */
  maxZoom: number
  /** The caller owns the bitmap and closes it. Never rejects. */
  loadTile: (zoom: number, row: number, col: number, signal: AbortSignal) => Promise<SurfaceTileResult>
  /** The ground resolution of tiles at `zoom`, DERIVED, for the caption. */
  resolutionAt: (zoom: number) => Classified<string>
  /**
   * The base map's tiles under a partly see-through grid layer:
   * drawn greyscale, with the layer's colours over them, not as the layer.
   */
  greyUnder?: boolean
}

/**
 * Finer imagery for the surface view's ground: its brightness comes
 * from these tiles, its colour from the active layer. The shell builds it
 * from the data layer and passes it with the text the caption needs; the
 * scene never learns the host. The shell passes a list, coarsest first:
 * each is drawn over the ones before it where it has tiles.
 */
export interface GroundImagery {
  detail: SurfaceDetail
  /** Pixels per tile side: sets the zoom that matches the patch image. */
  tilePx: number
  /**
   * Where the mosaic has tiles, degrees north and east (any turn of
   * longitude), or null for the whole planet. A patch it does not touch
   * loads none of its tiles and the caption does not name it.
   */
  coverage: { south: number; north: number; west: number; east: number } | null
  /**
   * Drawn only in the near-field image around the walker, never in
   * the 40 km patch, whose ≈ 20 m pixels would show none of it.
   */
  nearField?: boolean
  classification: 'OFFICIAL'
  label: string
  /** The credit line the producer asks for. */
  credit: string
  caveat: string
  licence: string
}

/**
 * The planet-wide mosaic among the ground imagery (CTX): the one with
 * no coverage box and not limited to the walker's near field. The globe
 * draws it below the layer's own finest tiles; null when there is none (a
 * data layer gets no ground imagery, useGroundImagery).
 */
export function globalGroundImagery(list: readonly GroundImagery[]): GroundImagery | null {
  return list.find((g) => g.coverage === null && !g.nearField) ?? null
}
