import { CanvasTexture, Float32BufferAttribute, PlaneGeometry, SRGBColorSpace } from 'three'
import type { DataClassification, MarsCoordinate } from '../../../domain'
import type { GroundImagery, SurfaceDetail } from '../surfaceDetail'
import type { SurfaceElevation } from '../surfaceElevation'
import type { Heightfield } from './heightfield'
import { drawPatchImage, type GroundTiles } from './patchImage'
import {
  boxUv,
  makeFrame,
  patchBox,
  patchGrid,
  PATCH_SIZE_KM,
  type PatchBox,
  type PatchFrame,
} from './surfacePatch'

/** Vertices per side: 125 m between them over 40 km. */
export const GROUND_GRID = 321

/** Metres between the mesh's vertices: no shape finer than this is drawn, whatever the heights' source. */
export const GROUND_SPACING_M = (PATCH_SIZE_KM * 1000) / (GROUND_GRID - 1)

/** Where the heights of a patch came from, for the caption. */
export interface HeightProvenance {
  classification: Exclude<DataClassification, 'UNAVAILABLE'>
  /** The source's own words: its source, or its method if DERIVED. */
  text: string
}

/**
 * One 40 km square of ground, ready to draw: the mesh in patch-local metres
 * (x east, y up, −z north), its imagery, and the heights for walking on it.
 * Owns its GPU objects and tile loads; `dispose` releases them all.
 */
export interface GroundPatch {
  frame: PatchFrame
  /** The lat/lon box `image` covers. */
  box: PatchBox
  field: Heightfield
  geometry: PlaneGeometry
  texture: CanvasTexture
  /** The overhead imagery the texture is made from, north at the top; also the minimap's picture. */
  image: HTMLCanvasElement
  /** Each ground mosaic's tiles in `image`, coarsest first; empty when the layer is draped alone. */
  ground: GroundTiles[]
  /** The mosaic for the near field around the walker (useNearField), from the same sources; null for none. */
  near: GroundImagery | null
  provenance: HeightProvenance
  dispose: () => void
}

export type GroundPatchResult =
  | { status: 'ready'; patch: GroundPatch }
  | { status: 'unavailable'; reason: string }
  | { status: 'aborted' }

export interface GroundSources {
  elevation: SurfaceElevation
  detail: SurfaceDetail | null
  /** Finer brightness for the ground, coarsest first, composed over the layer's colour; empty to drape the layer alone. */
  groundImagery: readonly GroundImagery[]
  globeImage: HTMLCanvasElement | null
  maxAnisotropy: number
}

/**
 * Builds the patch centred on `centre`. Heights first: if the source has
 * none, nothing is built and the reason is returned. Imagery keeps filling
 * in after the patch is returned.
 */
export async function buildGroundPatch(
  centre: MarsCoordinate,
  sources: GroundSources,
  signal: AbortSignal,
): Promise<GroundPatchResult> {
  const frame = makeFrame(centre)
  const points = patchGrid(frame, GROUND_GRID)
  const heights = await sources.elevation.sample(points, signal)
  if (signal.aborted) return { status: 'aborted' }
  if (heights.classification === 'UNAVAILABLE') {
    return { status: 'unavailable', reason: heights.reason }
  }
  if (heights.value.length !== GROUND_GRID * GROUND_GRID) {
    return { status: 'unavailable', reason: 'The elevation source returned the wrong number of heights' }
  }

  const sizeM = PATCH_SIZE_KM * 1000
  const geometry = new PlaneGeometry(sizeM, sizeM, GROUND_GRID - 1, GROUND_GRID - 1)
  // PlaneGeometry's vertices run row 0 north, column 0 west: the grid's order.
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) position.setZ(i, heights.value[i])

  // Texture coordinates into an equirectangular image of the patch's box.
  const box = patchBox(frame, points)
  const lon0 = centre.longitudeEast
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const p = boxUv(box, lon0, points[i * 2], points[i * 2 + 1])
    uv[i * 2] = p.u
    uv[i * 2 + 1] = p.v
  }
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  // Plane's +y (north) becomes −z and its +z (height) becomes +y.
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()

  const tiles = new AbortController()
  let texture: CanvasTexture | null = null
  const { canvas, ground } = drawPatchImage(
    box,
    lon0,
    sources.globeImage,
    sources.detail,
    sources.groundImagery,
    tiles.signal,
    () => {
      if (texture) texture.needsUpdate = true
    },
  )
  texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = sources.maxAnisotropy
  const tex = texture

  return {
    status: 'ready',
    patch: {
      frame,
      box,
      image: canvas,
      ground,
      near: sources.groundImagery.find((g) => g.nearField) ?? null,
      field: { heights: heights.value, size: GROUND_GRID, spacingM: GROUND_SPACING_M },
      geometry,
      texture: tex,
      provenance: {
        classification: heights.classification,
        text: heights.classification === 'DERIVED' ? heights.method : heights.source,
      },
      dispose: () => {
        tiles.abort()
        geometry.dispose()
        tex.dispose()
      },
    },
  }
}
