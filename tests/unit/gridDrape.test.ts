import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_LAYER_ID,
  baseDetailUnderGrid,
  drapeGrid,
  GRID_OVERLAY_ALPHA,
  readLayerCatalogue,
} from '../../src/app/surfaceLayers'
import { derived, official, type MapLayerId } from '../../src/domain'
import { GREYSCALE_LINE, greyscaleMap } from '../../src/features/mars-3d/greyscaleMap'
import type { SurfaceImage } from '../../src/state'

// A thermal grid layer lies partly see-through over the grey base, in
// two parts the globe can put the base map's greyscale tiles between.
describe('the see-through grid layers', () => {
  /** A canvas whose 2D context records what is drawn on it, and at what opacity. */
  function canvasNamed(name: string, log: string[], width = 2048, height = 1024, refuses = false) {
    const ctx = {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      fillRect() {},
      clearRect() {
        log.push(`${name}: clear`)
      },
      drawImage(image: { name?: string }) {
        log.push(`${name}: draw ${image.name ?? '?'} at ${ctx.globalAlpha}`)
      },
    }
    return { name, width, height, getContext: () => (refuses ? null : ctx) } as unknown as HTMLCanvasElement
  }
  const nameOf = (c: HTMLCanvasElement | undefined) => (c as unknown as { name: string } | undefined)?.name
  afterEach(() => vi.unstubAllGlobals())
  const stubDocument = (log: string[], refuses = false) => {
    let n = 0
    vi.stubGlobal('document', { createElement: () => canvasNamed(`new${++n}`, log, 0, 0, refuses) })
  }
  const readyImage = (layerId: MapLayerId, image: HTMLCanvasElement): Extract<SurfaceImage, { status: 'ready' }> => ({
    status: 'ready',
    layerId,
    image,
    sourceResolution: official('fixture', 'fixture'),
    servedResolution: derived('fixture', 'fixture'),
    base: { status: 'unavailable', reason: 'Base map not drawn' },
  })
  const drawBase = () => true

  it('covers the ground with 0.6 of the colour: most of each pixel, the ground still showing', () => {
    expect(GRID_OVERLAY_ALPHA).toBeGreaterThanOrEqual(0.55)
    expect(GRID_OVERLAY_ALPHA).toBeLessThanOrEqual(0.65)
  })

  it("fades a copy of the grid, then composes the grey base and that copy into the layer's canvas", () => {
    const log: string[] = []
    stubDocument(log)
    const grid = canvasNamed('grid', log)
    const out = drapeGrid(readyImage('thermal', grid), readyImage(BASE_LAYER_ID, canvasNamed('base', log)), drawBase)
    if (out.status !== 'ready') throw new Error('expected a ready image')
    expect(out.image).toBe(grid)
    expect(out.base).toEqual({ status: 'drawn', layerId: BASE_LAYER_ID })
    const under = nameOf(out.drape?.under)
    const over = nameOf(out.drape?.over)
    expect(under).toBeDefined()
    expect(over).toBeDefined()
    // The faded copy is made before the layer's canvas is cleared, at the overlay's opacity.
    expect(log).toEqual([`${over}: draw grid at ${GRID_OVERLAY_ALPHA}`, 'grid: clear', `grid: draw ${under} at 1`, `grid: draw ${over} at 1`])
  })

  it('keeps the grid opaque, with no drape, when the base is not there to go under', () => {
    const log: string[] = []
    stubDocument(log)
    const layer = readyImage('thermal', canvasNamed('grid', log))
    for (const base of [null, { status: 'loading', layerId: BASE_LAYER_ID } as const]) {
      const out = drapeGrid(layer, base, drawBase)
      if (out.status !== 'ready') throw new Error('expected a ready image')
      expect(out.drape).toBeUndefined()
      expect(out.base.status).toBe('unavailable')
    }
    expect(log.some((l) => l.endsWith(` at ${GRID_OVERLAY_ALPHA}`))).toBe(false)
  })

  it('keeps the grid opaque when a canvas refuses', () => {
    stubDocument([], true)
    const out = drapeGrid(readyImage('thermal', canvasNamed('grid', [])), readyImage(BASE_LAYER_ID, canvasNamed('base', [])), drawBase)
    expect(out.status === 'ready' && out.drape).toBeUndefined()
  })

  it('passes a layer that is not ready through unchanged', () => {
    const loading: SurfaceImage = { status: 'loading', layerId: 'thermal' }
    expect(drapeGrid(loading, null, drawBase)).toBe(loading)
  })

  it("offers the base map's tiles, marked greyscale, to go under a grid layer", () => {
    const detail = baseDetailUnderGrid(readLayerCatalogue().byId.get(BASE_LAYER_ID))
    expect(detail?.layerId).toBe(BASE_LAYER_ID)
    expect(detail?.greyUnder).toBe(true)
    expect(baseDetailUnderGrid({ status: 'unavailable', id: BASE_LAYER_ID, reason: 'fixture' })).toBeNull()
    expect(baseDetailUnderGrid(undefined)).toBeNull()
  })
})

describe('greyscaleMap', () => {
  it('turns the sampled map grey right after it is sampled', () => {
    const shader = { fragmentShader: 'void main() {\n#include <map_fragment>\n#include <lights_lambert_fragment>\n}' }
    greyscaleMap(shader)
    expect(shader.fragmentShader).toBe(`void main() {\n#include <map_fragment>\n${GREYSCALE_LINE}\n#include <lights_lambert_fragment>\n}`)
  })

  it('weighs the channels as the canvas saturation blend does, on sRGB values', () => {
    expect(GREYSCALE_LINE).toContain('vec3( 0.3, 0.59, 0.11 )')
    expect(GREYSCALE_LINE).toContain('1.0 / 2.2')
  })

  it('leaves a shader without a map alone', () => {
    const shader = { fragmentShader: 'void main() {}' }
    greyscaleMap(shader)
    expect(shader.fragmentShader).toBe('void main() {}')
  })
})
