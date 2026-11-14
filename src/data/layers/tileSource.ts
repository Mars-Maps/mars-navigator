/**
 * What the tile loader needs from any tiled source: the Mars Trek
 * layers and the ground-detail mosaic alike. The grid is Trek's
 * equirectangular one, 2^(z+1) × 2^z tiles from 180°W and 90°N; only the
 * host, the tile size and the finest zoom differ between sources.
 */
export interface TileSource {
  /** For messages and captions. */
  label: string
  /** Highest zoom the service serves. Nothing finer exists. */
  maxZoom: number
  /** Pixels per tile side. */
  tilePx: number
  /**
   * Latitudes the product covers, degrees north, and for a regional product
   * its longitudes, degrees east on the grid's −180 to 180. Tiles wholly
   * outside are not requested (the services answer 404 there, not an empty
   * tile). Give `west` and `east` together or not at all.
   */
  coverage: { south: number; north: number; west?: number; east?: number }
  tileUrl: (zoom: number, row: number, col: number) => string
}
