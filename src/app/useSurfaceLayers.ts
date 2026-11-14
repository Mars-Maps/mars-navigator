import { useEffect, useMemo, useRef, useState } from 'react'
import { loadLayerLegend } from '../data/adapters/LayerAdapter'
import type { MapLayer } from '../domain'
import type { GroundImagery, SurfaceDetail } from '../features/mars-3d/surfaceDetail'
import { isGridVariant, useLayerLegends, useMissionStore, useThermalVariant, type SurfaceImage } from '../state'
import {
  BASE_LAYER_ID,
  baseDetailUnderGrid,
  drapeGrid,
  greyBasePicture,
  groundImageryList,
  loadSurfaceImage,
  pendingLegend,
  readLayerCatalogue,
  surfaceDetailFor,
  withBaseUnder,
  withThermalVariant,
} from './surfaceLayers'

/**
 * The surface view's finer ground imagery, under the satellite layer
 * only: it sharpens that layer's colour with CTX brightness, and a data
 * layer (thermal, elevation, geology) keeps its own picture. Coarsest first:
 * global CTX, then the Jezero CTX mosaic, which the scene draws only
 * where a patch meets it. Built once; a source that fails validation is
 * left out.
 */
export function useGroundImagery(): readonly GroundImagery[] {
  const activeLayerId = useMissionStore((s) => s.activeLayerId)
  const imagery = useMemo(() => groundImageryList(), [])
  return activeLayerId === BASE_LAYER_ID ? imagery : NO_GROUND_IMAGERY
}

const NO_GROUND_IMAGERY: readonly GroundImagery[] = []

/**
 * Keeps the store's `layers` and `surfaceImage` in step with the layer
 * adapter. Mount once, in App. The catalogue is read once. The base
 * layer is loaded once and kept for the life of the shell; the active
 * layer's image is loaded whenever `activeLayerId` changes, gets the base
 * drawn under its gaps, and a load still in flight for the previous layer
 * is cancelled so it cannot land on top of the newer one. A layer whose
 * legend is a list of named classes gets it read from its producer the
 * first time it is selected, into the legends store. The thermal
 * layer is the day or night mosaic as the user chose; switching
 * reloads only the thermal image, and only while thermal is shown. Its
 * grid variants come from their own chunk, which paints the TES
 * grid or runs the temperature model and hands the picture and the layer's
 * description back. Returns the detail-tile loader for the active layer,
 * for the scene; under a grid variant, the base map's, greyscale.
 */
export function useSurfaceLayers(): SurfaceDetail | null {
  const activeLayerId = useMissionStore((s) => s.activeLayerId)
  const thermalVariant = useThermalVariant((s) => s.thermalVariant)
  // The grid variant shown, and its layer once the chunk has described it.
  const grid = activeLayerId === 'thermal' && isGridVariant(thermalVariant) ? thermalVariant : null
  const [gridLayer, setGridLayer] = useState<{ variant: string; layer: MapLayer } | null>(null)
  const dayCatalogue = useMemo(() => readLayerCatalogue(), [])
  const catalogue = useMemo(
    () => withThermalVariant(dayCatalogue, thermalVariant, undefined, gridLayer?.variant === grid ? gridLayer.layer : null),
    [dayCatalogue, thermalVariant, grid, gridLayer],
  )
  // The active layer's entry: the same object unless the active layer's own source changed.
  const active = catalogue.byId.get(activeLayerId)
  // The one base load, shared by every active-layer load; null when unmounted.
  const base = useRef<Promise<SurfaceImage> | null>(null)

  useEffect(() => {
    useMissionStore.getState().setLayers(catalogue.layers)
  }, [catalogue])

  useEffect(() => {
    const legend = pendingLegend(catalogue.layers, activeLayerId, useLayerLegends.getState().byLayer)
    if (legend === null) return
    const controller = new AbortController()
    loadLayerLegend(legend, controller.signal).then((entries) => {
      // Switched away or unmounted before the read landed: the next
      // selection of this layer asks again.
      if (!controller.signal.aborted) useLayerLegends.getState().setLayerLegend(activeLayerId, entries)
    })
    return () => controller.abort()
  }, [activeLayerId, catalogue])

  useEffect(() => {
    const controller = new AbortController()
    base.current = loadSurfaceImage(
      BASE_LAYER_ID,
      dayCatalogue.byId.get(BASE_LAYER_ID),
      controller.signal,
    )
    return () => {
      controller.abort()
      base.current = null
    }
  }, [dayCatalogue])

  useEffect(() => {
    const controller = new AbortController()
    const { setSurfaceImage } = useMissionStore.getState()
    setSurfaceImage({ status: 'loading', layerId: activeLayerId })
    const basePromise: Promise<SurfaceImage | null> = base.current ?? Promise.resolve(null)
    if (grid !== null) {
      // Until the first picture: the grey base alone, still "loading", not the near-black no-data globe.
      let painted = false
      void basePromise.then((loadedBase) => {
        if (controller.signal.aborted || painted) return
        const placeholder = greyBasePicture(loadedBase)
        if (placeholder !== null) setSurfaceImage({ status: 'loading', layerId: activeLayerId, placeholder })
      })
      // The chunk paints and repaints; each picture is laid partly see-through over the grey base.
      const sink = {
        onImage: (image: SurfaceImage) => {
          painted = true
          void basePromise.then((loadedBase) => {
            if (!controller.signal.aborted) setSurfaceImage(drapeGrid(image, loadedBase))
          })
        },
        onLayer: (layer: MapLayer) => {
          if (!controller.signal.aborted) setGridLayer({ variant: grid, layer })
        },
      }
      void import('./thermalGridLayer').then(
        (m) => {
          if (controller.signal.aborted) return
          if (grid === 'inertia') void m.startInertiaLayer(sink, controller.signal)
          else m.startTemperatureLayer(sink, controller.signal)
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setSurfaceImage({
              status: 'unavailable',
              layerId: activeLayerId,
              reason: `The thermal grid layer could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
            })
          }
        },
      )
      return () => controller.abort()
    }
    const cancelled: SurfaceImage = { status: 'unavailable', layerId: activeLayerId, reason: 'Cancelled' }
    // The base layer itself is shown from the shared load, not fetched twice.
    const layerPromise: Promise<SurfaceImage> =
      activeLayerId === BASE_LAYER_ID
        ? basePromise.then((b) => b ?? cancelled)
        : loadSurfaceImage(activeLayerId, active, controller.signal)
    Promise.all([layerPromise, basePromise]).then(([layer, loadedBase]) => {
      // Cancelled by a newer selection: that effect owns the store now.
      if (controller.signal.aborted) return
      setSurfaceImage(withBaseUnder(layer, loadedBase))
    })
    return () => controller.abort()
  }, [activeLayerId, active, grid])

  // A grid variant is drawn whole; the base map's tiles go under it, greyscale, so the crater shows through.
  // One object for both grid variants, so switching between them keeps the tiles already loaded.
  const baseResult = dayCatalogue.byId.get(BASE_LAYER_ID)
  const underGrid = useMemo(() => baseDetailUnderGrid(baseResult), [baseResult])
  const layerDetail = useMemo(() => surfaceDetailFor(activeLayerId, active), [activeLayerId, active])
  return grid !== null ? underGrid : layerDetail
}
