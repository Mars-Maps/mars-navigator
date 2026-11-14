import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_LAYER_ID,
  drawGreyBaseUnder,
  drawGridBaseUnder,
  GLOBE_ZOOM,
  greyBasePicture,
  globeZoomFor,
  groundImageryFor,
  loadSurfaceImage,
  readLayerCatalogue,
  fillNoDataUnder,
  pendingLegend,
  withBaseUnder,
} from '../../src/app/surfaceLayers'
import {
  describeGroundDetail,
  describeLayers,
  type LayerLoadResult,
  type PlacedTile,
  type TileIo,
} from '../../src/data/adapters/LayerAdapter'
import { LAYER_SOURCES } from '../../src/data/layers/layerSources'
import { derived, official, type MapLayerId } from '../../src/domain'
import { servedResolution } from '../../src/data/adapters/LayerAdapter'
import { NO_DATA_CSS, useMissionStore, type SurfaceImage } from '../../src/state'

// Fake bitmaps: the loader only passes them to stitch and closes them.
function fakeIo(fail: (url: string) => boolean = () => false) {
  const requested: string[] = []
  let stitched: { tiles: PlacedTile[]; width: number; height: number } | null = null
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement
  const io: TileIo = {
    async fetchTile(url) {
      requested.push(url)
      if (fail(url)) throw new Error('The tile server returned 404 for a tile')
      return { close: () => {} } as unknown as ImageBitmap
    },
    stitch(tiles, width, height) {
      stitched = { tiles, width, height }
      canvas.width = width
      canvas.height = height
      return canvas
    },
  }
  return { io, requested, canvas, stitched: () => stitched }
}

const live = () => new AbortController().signal
const catalogue = readLayerCatalogue()
const result = (id: MapLayerId) => catalogue.byId.get(id)

describe('readLayerCatalogue', () => {
  it('lists every available layer for the store, in adapter order', () => {
    expect(catalogue.layers.map((l) => l.id)).toEqual(['satellite', 'elevation', 'thermal', 'geology'])
    expect(catalogue.byId.size).toBe(4)
  })

  it('keeps an unavailable layer and its reason instead of dropping it', () => {
    const results: LayerLoadResult[] = [
      ...describeLayers().slice(0, 1),
      { status: 'unavailable', id: 'thermal', reason: 'fixture reason' },
    ]
    const c = readLayerCatalogue(results)
    expect(c.layers.map((l) => l.id)).toEqual(['satellite'])
    expect(c.byId.get('thermal')).toEqual({ status: 'unavailable', id: 'thermal', reason: 'fixture reason' })
  })
})

describe('pendingLegend', () => {
  const layers = catalogue.layers

  it('names the geology legend to read the first time geology is selected', () => {
    const legend = pendingLegend(layers, 'geology', {})
    expect(legend?.kind).toBe('categories')
    expect(legend?.legendUrl).toMatch(/SIM3292_Global_Geology/)
  })

  it('reads nothing for a layer without named classes, a layer not listed, or one already read', () => {
    expect(pendingLegend(layers, 'satellite', {})).toBeNull()
    expect(pendingLegend([], 'geology', {})).toBeNull()
    expect(pendingLegend(layers, 'geology', { geology: official([], 'fixture') })).toBeNull()
    // An unavailable answer is an answer: no retry storm on a dead service.
    expect(pendingLegend(layers, 'geology', { geology: { classification: 'UNAVAILABLE', reason: 'x' } })).toBeNull()
  })
})

describe('globeZoomFor', () => {
  it('never asks for a zoom the service does not serve', () => {
    expect(globeZoomFor(7)).toBe(GLOBE_ZOOM)
    expect(globeZoomFor(1)).toBe(1)
    expect(globeZoomFor(0)).toBe(0)
  })
})

describe('loadSurfaceImage', () => {
  it('loads the satellite layer at the globe zoom with the source and served resolutions', async () => {
    const f = fakeIo()
    const s = await loadSurfaceImage('satellite', result('satellite'), live(), f.io)
    expect(s.status).toBe('ready')
    if (s.status !== 'ready') return
    expect(s.layerId).toBe('satellite')
    expect(s.image).toBe(f.canvas)
    expect(f.stitched()?.width).toBe(2048)
    expect(f.stitched()?.height).toBe(1024)
    expect(f.requested.every((u) => u.includes(`/${GLOBE_ZOOM}/`))).toBe(true)
    expect(s.sourceResolution).toEqual(LAYER_SOURCES.satellite?.sourceResolution)
    expect(s.servedResolution.classification).toBe('DERIVED')
    // The served figure describes zoom 2, not the service's finest zoom 7.
    if (s.servedResolution.classification === 'DERIVED') {
      expect(s.servedResolution.value).toMatch(/km\/px/)
      expect(s.servedResolution.method).toMatch(/Zoom 2 grid/)
    }
  })

  it('clamps to a coarse layer’s maximum zoom instead of failing', async () => {
    const f = fakeIo()
    // A fixture served to zoom 1 only, as the TES mineral map once was.
    const thermal = result('thermal')
    const coarse: LayerLoadResult | undefined =
      thermal?.status === 'available'
        ? { ...thermal, source: { ...thermal.source, maxZoom: 1 }, servedResolution: servedResolution(1) }
        : undefined
    const s = await loadSurfaceImage('thermal', coarse, live(), f.io)
    expect(s.status).toBe('ready')
    expect(f.requested.length).toBe(4 * 2)
    expect(f.requested.every((u) => u.includes('/1/'))).toBe(true)
    expect(f.stitched()?.width).toBe(1024)
    if (s.status === 'ready' && coarse?.status === 'available') {
      // At the service's own maximum the adapter's figure is reused as is.
      expect(s.servedResolution).toEqual(coarse.servedResolution)
    }
  })

  it('reports a failed tile as unavailable with the adapter’s reason', async () => {
    const f = fakeIo((url) => url.endsWith('/0/3.jpg'))
    const s = await loadSurfaceImage('elevation', result('elevation'), live(), f.io)
    expect(s).toEqual({
      status: 'unavailable',
      layerId: 'elevation',
      reason: expect.stringMatching(/Elevation .* failed to load: The tile server returned 404/),
    })
  })

  it('passes an unavailable catalogue entry through with its reason', async () => {
    const s = await loadSurfaceImage(
      'thermal',
      { status: 'unavailable', id: 'thermal', reason: 'No verified source for this layer yet' },
      live(),
      fakeIo().io,
    )
    expect(s).toEqual({
      status: 'unavailable',
      layerId: 'thermal',
      reason: 'No verified source for this layer yet',
    })
  })

  it('says so when the id is not in the catalogue', async () => {
    const s = await loadSurfaceImage('thermal', undefined, live(), fakeIo().io)
    expect(s).toEqual({ status: 'unavailable', layerId: 'thermal', reason: 'Not in the layer catalogue' })
  })

  it('a cancelled load comes back as unavailable, never as a half image', async () => {
    const controller = new AbortController()
    controller.abort()
    const f = fakeIo()
    const s = await loadSurfaceImage('satellite', result('satellite'), controller.signal, f.io)
    expect(s).toEqual({ status: 'unavailable', layerId: 'satellite', reason: 'Cancelled' })
    expect(f.requested).toEqual([])
  })
})

describe('groundImageryFor', () => {
  it('wraps the CTX mosaic as a tile loader with its caption text', async () => {
    const f = fakeIo()
    const imagery = groundImageryFor(describeGroundDetail(), f.io)
    expect(imagery).not.toBeNull()
    if (!imagery) return
    expect(imagery.classification).toBe('OFFICIAL')
    expect(imagery.label).toMatch(/CTX/)
    expect(imagery.credit).toBe('NASA/JPL/MSSS/The Murray Lab')
    expect(imagery.detail.layerId).toBe('ctx')
    expect(imagery.detail.maxZoom).toBe(11)
    const r = imagery.detail.resolutionAt(10)
    expect(r.classification === 'DERIVED' && r.value).toMatch(/^≈ 20 m\/px/)
    expect((await imagery.detail.loadTile(10, 540, 442, live())).status).toBe('ready')
    expect(f.requested[0]).toMatch(/astro\.arcgis\.com.*\/10\/540\/442$/)
  })

  it('is null when the source record is unusable', () => {
    expect(groundImageryFor({ status: 'unavailable', reason: 'No licence recorded' })).toBeNull()
  })
})

describe('withBaseUnder', () => {
  const canvas = (tag: string) => ({ tag }) as unknown as HTMLCanvasElement
  const ready = (layerId: MapLayerId, tag: string): Extract<SurfaceImage, { status: 'ready' }> => ({
    status: 'ready',
    layerId,
    image: canvas(tag),
    sourceResolution: official('fixture', 'fixture'),
    servedResolution: derived('fixture', 'fixture'),
    base: { status: 'unavailable', reason: 'fixture' },
  })
  const baseOf = (out: SurfaceImage) => (out.status === 'ready' ? out.base : null)
  const base = ready(BASE_LAYER_ID, 'base')
  const tagOf = (c: HTMLCanvasElement) => (c as unknown as { tag: string }).tag
  const noFill = () => {}

  it('draws the base under a data layer and records it', () => {
    const calls: string[] = []
    const thermal = ready('thermal', 'thermal')
    const out = withBaseUnder(
      thermal,
      base,
      (layer, b) => {
        calls.push(`${tagOf(layer)}<${tagOf(b)}`)
        return true
      },
      noFill,
    )
    expect(calls).toEqual(['thermal<base'])
    expect(baseOf(out)).toEqual({ status: 'drawn', layerId: BASE_LAYER_ID })
    expect(out.status === 'ready' && out.image).toBe(thermal.image)
  })

  it('marks the base layer itself as not needing one, without drawing', () => {
    const draw = () => {
      throw new Error('must not draw')
    }
    const out = withBaseUnder(base, base, draw, noFill)
    expect(baseOf(out)).toEqual({ status: 'not-needed' })
    expect(out.status === 'ready' && out.image).toBe(base.image)
  })

  it('says why the base is missing when it is absent, not ready, failed, or the wrong layer', () => {
    const thermal = ready('thermal', 'thermal')
    const draw = () => {
      throw new Error('must not draw')
    }
    const reason = (b: SurfaceImage | null) => {
      const out = baseOf(withBaseUnder(thermal, b, draw, noFill))
      return out?.status === 'unavailable' ? out.reason : out
    }
    expect(reason(null)).toBe('Base map not loaded')
    expect(reason({ status: 'loading', layerId: BASE_LAYER_ID })).toBe('Base map still loading')
    expect(reason({ status: 'unavailable', layerId: BASE_LAYER_ID, reason: 'HTTP 503' })).toBe(
      'Base map unavailable: HTTP 503',
    )
    expect(reason(ready('elevation', 'e'))).toMatch(/elevation, not satellite/)
  })

  it('reports an unavailable base when the canvas refused to draw, keeping the image', () => {
    const thermal = ready('thermal', 'thermal')
    const out = withBaseUnder(thermal, base, () => false, noFill)
    expect(baseOf(out)).toEqual({ status: 'unavailable', reason: 'Canvas could not draw the base map' })
    expect(out.status === 'ready' && out.image).toBe(thermal.image)
  })

  it('passes loading and unavailable layers through', () => {
    const loading: SurfaceImage = { status: 'loading', layerId: 'thermal' }
    const draw = () => {
      throw new Error('must not draw')
    }
    expect(withBaseUnder(loading, base, draw, noFill)).toBe(loading)
  })

  // The neutral fill lands under whatever the base left transparent,
  // so it runs after the base draw and in every case the layer is ready.
  it('fills the neutral colour under the layer after the base is drawn, for every ready layer', () => {
    const calls: string[] = []
    const draw = (layer: HTMLCanvasElement) => {
      calls.push(`draw ${tagOf(layer)}`)
      return true
    }
    const fill = (layer: HTMLCanvasElement) => {
      calls.push(`fill ${tagOf(layer)}`)
    }
    withBaseUnder(ready('thermal', 'thermal'), base, draw, fill)
    expect(calls).toEqual(['draw thermal', 'fill thermal'])

    calls.length = 0
    withBaseUnder(base, base, draw, fill)
    expect(calls).toEqual(['fill base'])

    calls.length = 0
    withBaseUnder(ready('thermal', 'thermal'), null, draw, fill)
    expect(calls).toEqual(['fill thermal'])

    calls.length = 0
    withBaseUnder(ready('thermal', 'thermal'), base, () => false, fill)
    expect(calls).toEqual(['fill thermal'])
  })

  it('does not fill a layer that is not ready', () => {
    const fill = () => {
      throw new Error('must not fill')
    }
    const draw = () => true
    const unavailable: SurfaceImage = { status: 'unavailable', layerId: 'thermal', reason: 'HTTP 503' }
    expect(withBaseUnder({ status: 'loading', layerId: 'thermal' }, base, draw, fill).status).toBe('loading')
    expect(withBaseUnder(unavailable, base, draw, fill)).toBe(unavailable)
  })
})

describe('fillNoDataUnder', () => {
  // A recording 2D context: no DOM in unit tests, so the calls are the check.
  const recording = () => {
    const ops: string[] = []
    const ctx = {
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        ops.push(`${this.globalCompositeOperation} ${this.fillStyle} ${x},${y} ${w}x${h}`)
      },
    }
    const canvas = { width: 8, height: 4, getContext: () => ctx } as unknown as HTMLCanvasElement
    return { canvas, ctx, ops }
  }

  it('paints the shared no-data colour under the whole canvas and restores source-over', () => {
    const { canvas, ctx, ops } = recording()
    fillNoDataUnder(canvas)
    expect(ops).toEqual([`destination-over ${NO_DATA_CSS} 0,0 8x4`])
    expect(ctx.globalCompositeOperation).toBe('source-over')
  })

  it('leaves a canvas that refuses a 2D context alone', () => {
    const canvas = { width: 8, height: 4, getContext: () => null } as unknown as HTMLCanvasElement
    expect(() => fillNoDataUnder(canvas)).not.toThrow()
  })
})

describe('surfaceImage in the store', () => {
  it('starts null and takes whatever the shell writes', () => {
    useMissionStore.setState({ surfaceImage: null })
    expect(useMissionStore.getState().surfaceImage).toBeNull()
    useMissionStore.getState().setSurfaceImage({ status: 'loading', layerId: 'thermal' })
    expect(useMissionStore.getState().surfaceImage).toEqual({ status: 'loading', layerId: 'thermal' })
  })
})

// The grid layers' gaps are drawn from a full-brightness grey base, and
// the globe shows that base alone while a grid layer computes its first picture.
describe('the grid layers\' grey base', () => {
  /** A canvas whose 2D context records the fills and composite modes it is given. */
  function recordingCanvas(log: string[], width = 0, height = 0) {
    const ctx = {
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      fillRect() {
        log.push(`${ctx.globalCompositeOperation} ${ctx.fillStyle}`)
      },
      drawImage() {
        log.push(`${ctx.globalCompositeOperation} image`)
      },
    }
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement
  }
  afterEach(() => vi.unstubAllGlobals())
  const stubDocument = (log: string[]) =>
    vi.stubGlobal('document', { createElement: () => recordingCanvas(log) })

  it('halves the base for other layers and leaves it at full brightness for the grids', () => {
    const other: string[] = []
    stubDocument(other)
    expect(drawGreyBaseUnder(recordingCanvas([]), recordingCanvas([]))).toBe(true)
    expect(other).toContain('multiply #808080')

    const grid: string[] = []
    stubDocument(grid)
    expect(drawGridBaseUnder(recordingCanvas([]), recordingCanvas([]))).toBe(true)
    expect(grid).toContain('multiply #ffffff')
    expect(grid).not.toContain('multiply #808080')
    // Still greyscale: the colour is removed either way.
    expect(grid).toContain('saturation #808080')
  })

  const readyBase = (image: HTMLCanvasElement): SurfaceImage => ({
    status: 'ready',
    layerId: BASE_LAYER_ID,
    image,
    sourceResolution: official('fixture', 'fixture'),
    servedResolution: derived('fixture', 'fixture'),
    base: { status: 'not-needed' },
  })

  it('paints the base alone on a canvas the size of the base image', () => {
    stubDocument([])
    const drawn: { w: number; h: number }[] = []
    const out = greyBasePicture(readyBase(recordingCanvas([], 2048, 1024)), (layer) => {
      drawn.push({ w: layer.width, h: layer.height })
      return true
    })
    expect(out).not.toBeNull()
    expect(drawn).toEqual([{ w: 2048, h: 1024 }])
  })

  it('has no picture without a ready base, or when the canvas refuses', () => {
    const draw = () => true
    expect(greyBasePicture(null, draw)).toBeNull()
    expect(greyBasePicture({ status: 'loading', layerId: BASE_LAYER_ID }, draw)).toBeNull()
    expect(greyBasePicture({ status: 'unavailable', layerId: BASE_LAYER_ID, reason: 'x' }, draw)).toBeNull()
    stubDocument([])
    expect(greyBasePicture(readyBase(recordingCanvas([], 4, 2)), () => false)).toBeNull()
  })
})
