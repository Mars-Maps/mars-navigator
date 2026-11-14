import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  PerspectiveCamera,
  SRGBColorSpace,
  Texture,
  type BufferGeometry,
} from 'three'
import { useMissionStore } from '../../state'
import { CAMERA_FOV_DEG, GLOBE_RADIUS, KM_PER_SCENE_UNIT } from './constants'
import type { SurfaceDetail } from './surfaceDetail'
import { greyscaleMap } from './greyscaleMap'
import { PICTURE_LIFT } from './overlayLift'
import { buildTilePatch } from './tilePatch'
import { tileBounds, tilesForView, type TileIndex } from './tilePyramid'
import { TileStore, type ShownTile, type TileResources } from './tileStore'

/** Tiles sit this far above the mean sphere: above the 96-segment sphere's facets, below the grid (1.001). */
const LIFT = 1.0006
/** The finer ground under the satellite layer sits just above the layer's own tiles, so it draws over them. */
export const GROUND_LIFT = PICTURE_LIFT
/**
 * Tiles the CTX ground keeps. A 512 px tile is about 1 MB of bitmap
 * and 1.4 MB of mipmapped texture, four times a Trek tile, so half the
 * store's default 256 keeps the worst case near 300 MB. Wanted tiles are
 * never evicted, so this only limits what is kept from earlier views.
 */
export const GROUND_TILE_CAP = 128

interface GpuTile extends TileResources {
  texture: Texture
  geometry: BufferGeometry
}

/** Tiles never answer a pick: hover and right-click reach the sphere underneath. */
function noRaycast() {}

const NO_TILES: ShownTile<GpuTile>[] = []
const noStore = {
  subscribe: () => () => {},
  getSnapshot: () => NO_TILES,
}

/**
 * Detail tiles over the whole-globe image. Mount inside the globe
 * mesh so they spin and tilt with it. The visible set is recomputed when
 * the camera settles (the store's `camera`), the viewport changes, or the
 * layer changes; never per frame. TileStore does the fetching, caching
 * and disposal; this component only turns a bitmap into a texture and a
 * patch, and draws what the store says is ready, coarser stand-ins
 * included. Nothing is loaded in
 * welcome. Materials are JSX, so R3F disposes them; textures, geometries
 * and bitmaps are disposed by the store on eviction, layer change and
 * unmount.
 */
export function SurfaceTiles({
  detail,
  onZoomChange,
  tilePx,
  finerThanZoom,
  belowAltitudeKm,
  cap,
  lift = LIFT,
}: {
  detail: SurfaceDetail | null
  /** The zoom of the tiles now shown, or null when none are; for the caption. */
  onZoomChange?: (zoom: number | null) => void
  /** The source's tile width when it is not Trek's 256 (the global CTX mosaic serves 512). */
  tilePx?: number
  /**
   * Fill in only where another source runs out: none while that
   * source's finest zoom, with its tile width, is as fine as the screen
   * asks. See `tilesForView`.
   */
  finerThanZoom?: number
  /** Nothing at or above this camera altitude, km (the CTX ground only below the old floor). */
  belowAltitudeKm?: number
  /** Tiles kept in memory; the store's default suits 256 px tiles, a 512 px source wants fewer. */
  cap?: number
  /** Radius of the tile patches, in globe radii. */
  lift?: number
}) {
  const view = useMissionStore((s) => s.camera)
  const viewMode = useMissionStore((s) => s.viewMode)
  const size = useThree((s) => s.size)
  // Tiles are matched to device pixels, not CSS pixels, so a high-density
  // screen gets the finer zooms it can show.
  const dpr = useThree((s) => s.viewport.dpr)
  const camera = useThree((s) => s.camera)
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const fovDeg = camera instanceof PerspectiveCamera ? camera.fov : CAMERA_FOV_DEG

  const make = useCallback(
    (tile: TileIndex, image: ImageBitmap): GpuTile => {
      const texture = new Texture(image)
      texture.flipY = false
      texture.colorSpace = SRGBColorSpace
      texture.minFilter = LinearMipmapLinearFilter
      texture.magFilter = LinearFilter
      texture.anisotropy = Math.min(4, maxAnisotropy)
      texture.needsUpdate = true
      const geometry = buildTilePatch(tileBounds(tile), GLOBE_RADIUS * lift)
      return {
        texture,
        geometry,
        dispose() {
          texture.dispose()
          geometry.dispose()
        },
      }
    },
    [maxAnisotropy, lift],
  )

  // One store per layer; disposing it frees every tile of that layer.
  // Activated on every effect setup: StrictMode runs a new effect's cleanup
  // and setup again with the memo kept, and without this the kept store
  // stayed disposed and ignored every update, so a scene mounted with a
  // layer already chosen showed no tiles in development.
  const store = useMemo(() => (detail ? new TileStore(detail, make, cap) : null), [detail, make, cap])
  useEffect(() => {
    store?.activate()
    return () => store?.dispose()
  }, [store])

  useEffect(() => {
    if (!store || !detail) return
    const wanted =
      viewMode !== 'welcome' && view && !(belowAltitudeKm !== undefined && view.altitudeKm >= belowAltitudeKm)
        ? tilesForView(
            view,
            { fovDeg, heightPx: size.height * dpr, aspect: size.width / size.height },
            detail.maxZoom,
            GLOBE_RADIUS * KM_PER_SCENE_UNIT,
            {
              tilePx,
              finerThan: finerThanZoom === undefined ? undefined : { maxZoom: finerThanZoom },
            },
          )
        : null
    store.update(wanted)
    onZoomChange?.(wanted ? wanted.zoom : null)
  }, [store, detail, view, viewMode, size, dpr, fovDeg, onZoomChange, tilePx, finerThanZoom, belowAltitudeKm])

  // Unmounted, nothing of this source is on screen: the caption must not keep its last zoom.
  useEffect(() => () => onZoomChange?.(null), [onZoomChange])

  useEffect(() => {
    if (!store) onZoomChange?.(null)
  }, [store, onZoomChange])

  // The base map's tiles under a see-through grid layer are drawn greyscale, like the base there.
  const grey = detail?.greyUnder === true
  const shown = useSyncExternalStore(
    store ? store.subscribe : noStore.subscribe,
    store ? store.getSnapshot : noStore.getSnapshot,
  )

  return (
    <group>
      {shown.map(({ key, resources, fallback }) => (
        <mesh key={key} geometry={resources.geometry} raycast={noRaycast}>
          {/* Lit like the globe underneath, so the terminator crosses tiles too.
              alphaTest: a source's no-data pixels (THEMIS has gaps between
              its mosaics) are discarded, so the globe's own image, with the
              greyed base under it, shows there instead of black.
              A fallback (a coarser tile standing in while finer ones load)
              is pushed back in depth so the finer tiles at the same radius
              draw over it. */}
          <meshLambertMaterial
            key={`${fallback ? 'under' : 'over'}${grey ? '-grey' : ''}`}
            map={resources.texture}
            onBeforeCompile={grey ? greyscaleMap : undefined}
            alphaTest={0.5}
            polygonOffset={fallback}
            polygonOffsetFactor={fallback ? 1 : 0}
            polygonOffsetUnits={fallback ? 4 : 0}
          />
        </mesh>
      ))}
    </group>
  )
}
