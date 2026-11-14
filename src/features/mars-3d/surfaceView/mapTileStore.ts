import type { SurfaceDetail } from '../surfaceDetail'
import type { TileIndex } from '../tilePyramid'
import { TileStore, type TileResources } from '../tileStore'

/** The overhead map's tiles: at most this many held at once. */
const TILE_CACHE = 192

export interface MapTile extends TileResources {
  tile: TileIndex
  image: ImageBitmap
}

// The store closes the bitmap; nothing else is held per tile.
const makeTile = (tile: TileIndex, image: ImageBitmap): MapTile => ({ tile, image, dispose() {} })

export function createMapTileStore(detail: SurfaceDetail): TileStore<MapTile> {
  return new TileStore<MapTile>(detail, makeTile, TILE_CACHE)
}
