import type { ThermalGrid } from '../data/adapters/ThermalGridAdapter'
import {
  INERTIA_RAMP,
  TEMPERATURE_RAMP_C,
  TES_INERTIA_CITATION,
  TES_INERTIA_LAYER,
  gridValues,
  modelledTemperatureLayer,
} from '../data/thermal/thermalLayers'
import { CELSIUS_OFFSET_K, derived, isAvailable, marsSolarTime, official, type MapLayer, type MarsSolarTime } from '../domain'
import {
  LAYER_CURVE_STEPS,
  TEMPERATURE_LAYER_PENDING_METHOD,
  layerTemperaturesK,
  planTemperatureLayer,
  seasonOf,
  temperatureLayerMethod,
  type TemperatureLayerPlan,
  type ThermalInputGrid,
} from '../features/route-analysis/temperatureLayer'
import { VALIDATED_ERROR } from '../features/route-analysis/temperatureModel'
import { paintRamp, type RampStop } from '../lib/colorRamp'
import { useMissionTimeStore, useThermalVariant, type SurfaceImage } from '../state'
import type { LayerCurvesReply, LayerCurvesRequest } from './temperatureLayer.worker'
import type { TesThermalGrids } from '../data/adapters/ThermalGridAdapter'
import { loadTesGridsOnce } from './tesGrids'

/**
 * The thermal layer's grid variants, loaded as their own chunk the
 * first time one is chosen: the TES thermal inertia grid painted whole, and
 * the modelled surface temperature run over the same cells at mission time.
 * Each hands the shell a `SurfaceImage` like a tile layer's, so the globe,
 * the overhead map and the caption show it unchanged, and a `MapLayer`
 * for the menu and the caption. Nothing here touches React: the hook that
 * owns the variant starts and stops it.
 */

/** The whole-globe image's size, as the tile layers' (8 × 4 tiles of 256 px at zoom 2). */
export const GRID_IMAGE_WIDTH = 2048
export const GRID_IMAGE_HEIGHT = 1024

export interface GridLayerSink {
  /** A new picture, or why there is none. */
  onImage(image: SurfaceImage): void
  /** The layer's description for the menu and caption; sent once it is known. */
  onLayer(layer: MapLayer): void
}

const SERVED = derived('0.5° cells (about 30 km at the equator)', 'nearest cell of the TES map, scripts/build-tes-grids.mjs; drawn whole, no detail tiles')

/** Where a grid lies: its size in cells and its geographic placement. */
export type GridGeometry = Pick<ThermalGrid, 'widthPx' | 'heightPx' | 'pxPerDeg' | 'westDeg' | 'northDeg'>

/**
 * The rectangle of the whole-globe image a grid covers, in pixels: the
 * image is −180..180, 90..−90; the grid runs from its west and north edges
 * for width / pxPerDeg degrees east and height / pxPerDeg degrees south.
 */
export function gridImageRect(grid: GridGeometry): { x: number; y: number; w: number; h: number } {
  return {
    x: ((grid.westDeg + 180) / 360) * GRID_IMAGE_WIDTH,
    y: ((90 - grid.northDeg) / 180) * GRID_IMAGE_HEIGHT,
    w: (grid.widthPx / grid.pxPerDeg / 360) * GRID_IMAGE_WIDTH,
    h: (grid.heightPx / grid.pxPerDeg / 180) * GRID_IMAGE_HEIGHT,
  }
}

/**
 * Paints `values` (row-major, north to south, the grid's cells) through
 * the ramp into a whole-globe canvas: each cell one block of pixels, no
 * smoothing, so a cell is a cell and a gap stays transparent for the grey
 * base to show through. Painted opaque: the shell lays it partly
 * see-through over the base when the base is there (`drapeGrid`).
 * null when the canvas refuses.
 */
export function paintGridCanvas(values: ArrayLike<number>, grid: GridGeometry, ramp: readonly RampStop[]): HTMLCanvasElement | null {
  const cells = document.createElement('canvas')
  cells.width = grid.widthPx
  cells.height = grid.heightPx
  const c = cells.getContext('2d')
  const out = document.createElement('canvas')
  out.width = GRID_IMAGE_WIDTH
  out.height = GRID_IMAGE_HEIGHT
  const o = out.getContext('2d')
  if (!c || !o) return null
  c.putImageData(new ImageData(paintRamp(values, ramp), grid.widthPx, grid.heightPx), 0, 0)
  o.imageSmoothingEnabled = false
  const { x, y, w, h } = gridImageRect(grid)
  o.drawImage(cells, x, y, w, h)
  return out
}

const unavailableImage = (reason: string): SurfaceImage => ({ status: 'unavailable', layerId: 'thermal', reason })

/** The TES thermal inertia grid as the thermal layer's picture. */
export async function startInertiaLayer(sink: GridLayerSink, signal: AbortSignal): Promise<void> {
  sink.onLayer(TES_INERTIA_LAYER)
  const { grids } = await loadTesGridsOnce()
  if (signal.aborted) return
  const set = grids.sets.thermalInertia
  if ('failed' in set) return sink.onImage(unavailableImage(set.failed))
  const image = paintGridCanvas(gridValues(set.global), set.global, INERTIA_RAMP)
  if (image === null) return sink.onImage(unavailableImage('The browser refused a canvas for the grid'))
  sink.onImage({
    status: 'ready',
    layerId: 'thermal',
    image,
    sourceResolution: official('20 px/deg (about 3 km at the equator)', TES_INERTIA_CITATION),
    servedResolution: SERVED,
    base: { status: 'unavailable', reason: 'Base map not drawn' },
  })
}

/** The two global grids as one input grid, or why they cannot be. */
function inputGrid(grids: TesThermalGrids): ThermalInputGrid | string {
  const ti = grids.sets.thermalInertia
  const al = grids.sets.albedo
  if ('failed' in ti) return ti.failed
  if ('failed' in al) return al.failed
  const a = ti.global
  const b = al.global
  if (a.widthPx !== b.widthPx || a.heightPx !== b.heightPx || a.pxPerDeg !== b.pxPerDeg || a.westDeg !== b.westDeg || a.northDeg !== b.northDeg) {
    return 'The thermal inertia and albedo grids do not share one geometry, so no cell has both'
  }
  return {
    widthPx: a.widthPx,
    heightPx: a.heightPx,
    pxPerDeg: a.pxPerDeg,
    westDeg: a.westDeg,
    northDeg: a.northDeg,
    thermalInertia: gridValues(a),
    albedo: gridValues(b),
  }
}

/** How many workers share the runs: the cores, at most eight, at least one. */
export function workerCount(hardwareConcurrency: number | undefined): number {
  return Math.max(1, Math.min(8, Math.floor(hardwareConcurrency ?? 2)))
}

/** The slices `count` workers take of `total` runs, each `[from, to)`, empty slices left out. */
export function slices(total: number, count: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const size = Math.ceil(total / count)
  for (let from = 0; from < total; from += size) out.push({ from, to: Math.min(total, from + size) })
  return out
}

/**
 * Runs the plan's curves across workers, reporting progress to the
 * variant store; resolves with every curve end to end, or rejects with the
 * first worker's error. Aborting terminates the workers and resolves with
 * what there is: the caller checks the signal before using it.
 */
function runCurves(plan: TemperatureLayerPlan, signal: AbortSignal): Promise<Float32Array> {
  const { setLayerProgress } = useThermalVariant.getState()
  const total = plan.inputs.length
  const steps = LAYER_CURVE_STEPS
  const all = new Float32Array(total * steps)
  const parts = slices(total, workerCount(navigator.hardwareConcurrency))
  setLayerProgress({ done: 0, total })
  return new Promise<Float32Array>((resolve, reject) => {
    if (parts.length === 0) return resolve(all)
    const workers: Worker[] = []
    let done = 0
    const onAbort = () => {
      stop()
      resolve(all)
    }
    const stop = () => {
      signal.removeEventListener('abort', onAbort)
      for (const w of workers) w.terminate()
      setLayerProgress(null)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    for (const part of parts) {
      const worker = new Worker(new URL('./temperatureLayer.worker.ts', import.meta.url), { type: 'module' })
      workers.push(worker)
      worker.onmessage = (event: MessageEvent<LayerCurvesReply>) => {
        const { from, to, curves } = event.data
        all.set(curves, from * steps)
        done += to - from
        setLayerProgress({ done, total })
        worker.terminate()
        if (done >= total) {
          stop()
          resolve(all)
        }
      }
      worker.onerror = (event) => {
        stop()
        reject(new Error(event.message || 'a model worker failed'))
      }
      const request: LayerCurvesRequest = { inputs: plan.inputs, from: part.from, to: part.to }
      worker.postMessage(request)
    }
  })
}

/** The clock must move this far before the layer repaints: a Mars minute changes no cell by a visible step. */
export const REPAINT_AFTER_MS = 60_000

/**
 * The modelled temperature at mission time: describes the layer at
 * once (DERIVED, its runs pending), then plans and runs the curves for the
 * clock's season, paints every cell at its local time, and repaints when
 * the clock has moved a minute, at most once a frame; a new season runs
 * again, the old picture staying up meanwhile. Stops on abort.
 */
export function startTemperatureLayer(sink: GridLayerSink, signal: AbortSignal): void {
  let grid: ThermalInputGrid | null = null
  let plan: TemperatureLayerPlan | null = null
  let curves: Float32Array | null = null
  let running = false
  let frame = 0
  let paintedAtMs = Number.NaN
  let lastMethod: string | null = null

  const solarNow = (): MarsSolarTime | string => {
    const solar = marsSolarTime(useMissionTimeStore.getState().utcMs)
    return isAvailable(solar) ? solar.value : solar.reason
  }

  // The description changes only with the season's Ls, so the menu and caption are not re-rendered per tick.
  const describe = (method: string) => {
    if (method === lastMethod) return
    lastMethod = method
    sink.onLayer(modelledTemperatureLayer(method, VALIDATED_ERROR.errorK))
  }
  describe(TEMPERATURE_LAYER_PENDING_METHOD)

  /** Whether the clock has left the season the current runs were made for. */
  const seasonMoved = (): boolean => {
    const solar = solarNow()
    if (typeof solar === 'string' || plan === null) return false
    const season = seasonOf(solar)
    return season.declinationDeg !== plan.season.declinationDeg || season.distanceAu !== plan.season.distanceAu
  }

  const paint = () => {
    frame = 0
    if (signal.aborted || grid === null || plan === null || curves === null) return
    const solar = solarNow()
    if (typeof solar === 'string') return sink.onImage(unavailableImage(`No Mars time to run the model at: ${solar}`))
    const kelvin = layerTemperaturesK(grid, plan, curves, solar)
    for (let i = 0; i < kelvin.length; i++) kelvin[i] -= CELSIUS_OFFSET_K
    const image = paintGridCanvas(kelvin, grid, TEMPERATURE_RAMP_C)
    if (image === null) return sink.onImage(unavailableImage('The browser refused a canvas for the layer'))
    paintedAtMs = useMissionTimeStore.getState().utcMs
    const method = temperatureLayerMethod(plan, solar)
    describe(method)
    sink.onImage({
      status: 'ready',
      layerId: 'thermal',
      image,
      sourceResolution: derived('model on 0.5° cells', method),
      servedResolution: SERVED,
      base: { status: 'unavailable', reason: 'Base map not drawn' },
    })
  }

  const run = async () => {
    if (grid === null || running) return
    const solar = solarNow()
    if (typeof solar === 'string') return sink.onImage(unavailableImage(`No Mars time to run the model at: ${solar}`))
    running = true
    const next = planTemperatureLayer(grid, solar)
    describe(temperatureLayerMethod(next, solar))
    try {
      const result = await runCurves(next, signal)
      if (signal.aborted) return
      plan = next
      curves = result
      paint()
    } catch (error: unknown) {
      if (!signal.aborted) sink.onImage(unavailableImage(`The temperature model could not run: ${error instanceof Error ? error.message : String(error)}`))
    } finally {
      running = false
    }
    // The clock may have crossed into another season while the runs were out: run again, the picture up meanwhile.
    if (!signal.aborted && seasonMoved()) void run()
  }

  const onClock = (utcMs: number) => {
    if (signal.aborted || grid === null || plan === null) return
    if (seasonMoved()) {
      void run()
      return
    }
    if (Math.abs(utcMs - paintedAtMs) < REPAINT_AFTER_MS) return
    if (frame === 0) frame = requestAnimationFrame(paint)
  }

  const unsubscribe = useMissionTimeStore.subscribe((s, prev) => {
    if (s.utcMs !== prev.utcMs) onClock(s.utcMs)
  })
  signal.addEventListener(
    'abort',
    () => {
      unsubscribe()
      if (frame !== 0) cancelAnimationFrame(frame)
      useThermalVariant.getState().setLayerProgress(null)
    },
    { once: true },
  )

  useThermalVariant.getState().setLayerProgress({ done: 0, total: 0 })
  void loadTesGridsOnce().then(({ grids }) => {
    if (signal.aborted) return
    const input = inputGrid(grids)
    if (typeof input === 'string') {
      useThermalVariant.getState().setLayerProgress(null)
      return sink.onImage(unavailableImage(input))
    }
    grid = input
    void run()
  })
}
