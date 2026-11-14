import { describe, expect, it } from 'vitest'
import {
  describeGroundDetail,
  describeLayers,
  loadLayerImage,
  loadLayerTile,
  MAX_GLOBE_ZOOM,
  rowInCoverage,
  servedResolution,
  tileGrid,
  tileRowBand,
  tileSourceOf,
  tileUrl,
  validateGroundDetail,
  validateLayerSource,
  type PlacedTile,
  TileHttpError,
  type TileIo,
} from '../../src/data/adapters/LayerAdapter'
import { CTX_GROUND_DETAIL } from '../../src/data/layers/groundDetailSources'
import {
  LAYER_SOURCES,
  THERMAL_NIGHT_SOURCE,
  type LayerSource,
} from '../../src/data/layers/layerSources'
import type { MapLayerId } from '../../src/domain'

const satellite = LAYER_SOURCES.satellite as LayerSource
const geology = LAYER_SOURCES.geology as LayerSource
const thermal = LAYER_SOURCES.thermal as LayerSource

// Fake bitmaps: the loader only passes them to stitch and closes them.
function fakeIo(fail: (url: string) => boolean = () => false) {
  const requested: string[] = []
  const closed: string[] = []
  let stitched: { tiles: PlacedTile[]; width: number; height: number } | null = null
  const io: TileIo = {
    async fetchTile(url) {
      requested.push(url)
      if (fail(url)) throw new TileHttpError(404)
      return { close: () => closed.push(url) } as unknown as ImageBitmap
    },
    stitch(tiles, width, height) {
      stitched = { tiles, width, height }
      return {} as HTMLCanvasElement
    },
  }
  return { io, requested, closed, stitched: () => stitched }
}

describe('LAYER_SOURCES', () => {
  it('gives every layer a source, licence and its own id', () => {
    for (const [id, s] of Object.entries(LAYER_SOURCES)) {
      expect(s).not.toBeNull()
      expect(s?.layer.id).toBe(id)
      expect(validateLayerSource(s as LayerSource)).toBeNull()
      expect(s?.layer.classification).toBe('OFFICIAL')
    }
  })

  it('captions what each picture is not', () => {
    expect(LAYER_SOURCES.satellite?.layer.caveat).toBe('Colourized Viking mosaic, not true colour')
    expect(LAYER_SOURCES.elevation?.layer.caveat).toBe('Elevation-coded colour, not surface colour')
    expect(LAYER_SOURCES.thermal?.layer.caveat).toMatch(/not calibrated temperature/)
    expect(LAYER_SOURCES.geology?.layer.caveat).toMatch(/not surface colour/)
    expect(LAYER_SOURCES.geology?.layer.caveat).toMatch(/1:20,000,000/)
  })

  it('states the THEMIS polar gap in coverage and caption', () => {
    expect(LAYER_SOURCES.thermal?.coverage).toEqual({ south: -65, north: 65 })
    expect(LAYER_SOURCES.thermal?.layer.caveat).toMatch(/65°/)
  })

  it('cites a source resolution for every layer', () => {
    for (const s of Object.values(LAYER_SOURCES)) {
      expect(s?.sourceResolution.classification).toBe('OFFICIAL')
    }
  })
})

describe('THERMAL_NIGHT_SOURCE', () => {
  const night = THERMAL_NIGHT_SOURCE

  it('is a valid, OFFICIAL variant of the thermal layer, cited with its CC0 licence', () => {
    expect(validateLayerSource(night)).toBeNull()
    expect(night.layer.id).toBe('thermal')
    expect(night.layer.classification).toBe('OFFICIAL')
    expect(night.layer.licence).toMatch(/CC0 1\.0/)
    expect(night.layer.licence).toMatch(/10\.5066\/P96FA04Z/)
    expect(night.sourceResolution.classification).toBe('OFFICIAL')
  })

  it('shares its CC0 licence and DOI with the day layer, one registry entry for both mosaics', () => {
    expect(thermal.layer.licence).toBe(night.layer.licence)
    expect(thermal.layer.licence).not.toMatch(/credit required/i)
  })

  it('is a different mosaic from the day layer', () => {
    expect(night.trekLayer).not.toBe(thermal.trekLayer)
    expect(night.trekLayer).toMatch(/NightIR/)
  })

  it('captions qualitative brightness and the polar gap, and states why there is no legend', () => {
    expect(night.layer.caveat).toMatch(/not calibrated temperature/)
    expect(night.layer.caveat).toMatch(/65°/)
    // Its gaps are transparent and show the dimmed base: dark there must not read as cold.
    expect(night.layer.caveat).toMatch(/gaps within it .* not cold ground/)
    expect(night.coverage).toEqual({ south: -65, north: 65 })
    expect(night.layer.legend.kind).toBe('none')
    if (night.layer.legend.kind === 'none') expect(night.layer.legend.reason).toMatch(/qualitative/)
  })
})

describe('describeLayers', () => {
  it('returns all four layers, in order', () => {
    const results = describeLayers()
    expect(results.map((r) => (r.status === 'available' ? r.source.layer.id : r.id))).toEqual([
      'satellite',
      'elevation',
      'thermal',
      'geology',
    ])
    expect(results.every((r) => r.status === 'available')).toBe(true)
  })

  it('reports a layer with no source as unavailable instead of dropping it', () => {
    const results = describeLayers({ ...LAYER_SOURCES, geology: null })
    expect(results).toHaveLength(4)
    expect(results[3]).toEqual({
      status: 'unavailable',
      id: 'geology',
      reason: 'No verified source for this layer yet',
    })
  })

  it('reports an invalid record with its reason', () => {
    const noLicence = { ...satellite, layer: { ...satellite.layer, licence: ' ' } }
    const wrongId = { ...satellite, layer: { ...satellite.layer, id: 'thermal' as MapLayerId } }
    const results = describeLayers({ ...LAYER_SOURCES, satellite: noLicence, elevation: wrongId })
    expect(results[0]).toMatchObject({ status: 'unavailable', reason: 'No licence recorded' })
    expect(results[1]).toMatchObject({ status: 'unavailable', id: 'elevation' })
  })

  it('rejects bad zoom and coverage', () => {
    expect(validateLayerSource({ ...satellite, maxZoom: 1.5 })).toMatch(/zoom/)
    expect(validateLayerSource({ ...satellite, coverage: { south: 10, north: -10 } })).toMatch(
      /coverage/,
    )
    expect(validateLayerSource({ ...satellite, coverage: { south: -91, north: 90 } })).toMatch(
      /coverage/,
    )
  })
})

describe('tile grid and resolution', () => {
  it('follows Trek’s 2^(z+1) × 2^z grid', () => {
    expect(tileGrid(0)).toEqual({ cols: 2, rows: 1 })
    expect(tileGrid(3)).toEqual({ cols: 16, rows: 8 })
  })

  it('maps a row to its latitude band, row 0 at the north pole', () => {
    expect(tileRowBand(0, 0)).toEqual({ north: 90, south: -90 })
    expect(tileRowBand(3, 0)).toEqual({ north: 90, south: 67.5 })
    expect(tileRowBand(3, 7)).toEqual({ north: -67.5, south: -90 })
  })

  it('skips only the rows wholly outside the source coverage', () => {
    // THEMIS covers ±65°: at zoom 3 the polar rows (90..67.5°) hold no data.
    expect(rowInCoverage(thermal, 3, 0)).toBe(false)
    expect(rowInCoverage(thermal, 3, 7)).toBe(false)
    expect(rowInCoverage(thermal, 3, 1)).toBe(true)
    expect(rowInCoverage(thermal, 3, 6)).toBe(true)
    // Coarser rows overlap the band, so they are requested.
    expect(rowInCoverage(thermal, 2, 0)).toBe(true)
    expect(rowInCoverage(thermal, 0, 0)).toBe(true)
    // A global product needs every row.
    expect(rowInCoverage(satellite, 3, 0)).toBe(true)
  })

  it('builds the tile URL in the layer’s format, on the layer’s host', () => {
    expect(tileUrl(thermal, 1, 0, 3)).toBe(
      'https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/1/0/3.png',
    )
    // The geology map's capabilities send tiles to Trek's ArcGIS host.
    expect(tileUrl(geology, 1, 0, 3)).toBe(
      'https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/1/0/3.png',
    )
  })

  it('derives served resolution from the zoom and mean radius', () => {
    // zoom 1: 1024 px around 2π × 3389.5 km ≈ 21 297 km → 20.8 km/px
    const z1 = servedResolution(1)
    expect(z1.classification).toBe('DERIVED')
    expect(z1.classification === 'DERIVED' && z1.value).toBe('≈ 20.8 km/px at the equator (2.8 px/deg)')
    const z7 = servedResolution(7)
    expect(z7.classification === 'DERIVED' && z7.value).toMatch(/^≈ 325 m\/px/)
  })

  it('halves the served resolution for 512 px tiles', () => {
    // zoom 10, 512 px tiles: 2048 × 512 px across 21 297 km → 20 m/px
    const z10 = servedResolution(10, 512)
    expect(z10.classification === 'DERIVED' && z10.value).toBe('≈ 20 m/px at the equator (2912.7 px/deg)')
    const z11 = servedResolution(11, 512)
    expect(z11.classification === 'DERIVED' && z11.value).toMatch(/^≈ 10 m\/px/)
  })

  it('wraps a layer as a 256 px tile source with the Trek URL', () => {
    const t = tileSourceOf(satellite)
    expect(t.tilePx).toBe(256)
    expect(t.maxZoom).toBe(satellite.maxZoom)
    expect(t.label).toBe(satellite.layer.label)
    expect(t.tileUrl(5, 3, 7)).toBe(tileUrl(satellite, 5, 3, 7))
  })
})

describe('ground detail source', () => {
  it('lists the CTX mosaic as available, OFFICIAL, with licence, credit and caveat', () => {
    const r = describeGroundDetail()
    expect(r.status).toBe('available')
    if (r.status !== 'available') return
    expect(r.source.id).toBe('ctx')
    expect(r.source.classification).toBe('OFFICIAL')
    expect(r.source.credit).toBe('NASA/JPL/MSSS/The Murray Lab')
    expect(r.source.licence).toMatch(/Murray Lab/)
    expect(r.source.caveat).toMatch(/uncontrolled/i)
    expect(r.source.sourceResolution.classification).toBe('OFFICIAL')
    expect(r.source.tilePx).toBe(512)
    expect(r.source.maxZoom).toBe(11)
  })

  it('builds the Esri tile URL as z/row/col', () => {
    expect(CTX_GROUND_DETAIL.tileUrl(11, 1081, 884)).toBe(
      'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/11/1081/884',
    )
  })

  it('rejects a record without credit, with an odd tile size, or with bad coverage', () => {
    expect(validateGroundDetail({ ...CTX_GROUND_DETAIL, credit: ' ' })).toMatch(/credit/)
    expect(validateGroundDetail({ ...CTX_GROUND_DETAIL, tilePx: 300 })).toMatch(/tile size/)
    expect(validateGroundDetail({ ...CTX_GROUND_DETAIL, coverage: { south: 10, north: 5 } })).toMatch(/coverage/)
    expect(describeGroundDetail({ ...CTX_GROUND_DETAIL, licence: '' })).toEqual({
      status: 'unavailable',
      reason: 'No licence recorded',
    })
  })

  it('loads a CTX tile through loadLayerTile and refuses zoom 12', async () => {
    const f = fakeIo()
    const live = new AbortController().signal
    const r = await loadLayerTile(CTX_GROUND_DETAIL, 10, 540, 442, live, f.io)
    expect(r.status).toBe('ready')
    expect(f.requested).toEqual([CTX_GROUND_DETAIL.tileUrl(10, 540, 442)])
    const z12 = await loadLayerTile(CTX_GROUND_DETAIL, 12, 0, 0, live, f.io)
    expect(z12).toEqual({
      status: 'error',
      reason: 'CTX greyscale mosaic (Murray Lab, Caltech) is not served at zoom 12',
      retryable: false,
    })
    expect(f.requested).toHaveLength(1)
  })
})

describe('loadLayerImage', () => {
  const signal = () => new AbortController().signal
  // A fixture served to zoom 1 only, as the TES mineral map once was.
  const coarse: LayerSource = { ...geology, maxZoom: 1 }

  it('fetches every tile, stitches them in place and closes the bitmaps', async () => {
    const f = fakeIo()
    const result = await loadLayerImage(coarse, 1, signal(), f.io)
    expect(result.status).toBe('ready')
    expect(f.requested).toHaveLength(8)
    expect(f.stitched()).toMatchObject({ width: 1024, height: 512 })
    expect(f.stitched()?.tiles.map((t) => [t.row, t.col])).toContainEqual([1, 3])
    expect(f.closed).toHaveLength(8)
  })

  it('does not request rows outside coverage, and keeps the full-size canvas', async () => {
    // Trek returns 404 for THEMIS rows beyond 65°, so requesting them would
    // fail the whole image. The fake 404s them to prove they are never asked for.
    const f = fakeIo((url) => /\/3\/(0|7)\/\d+\.png$/.test(url))
    const result = await loadLayerImage(thermal, 3, signal(), f.io)
    expect(result.status).toBe('ready')
    expect(f.requested).toHaveLength(6 * 16)
    expect(f.requested.some((url) => /\/3\/0\//.test(url))).toBe(false)
    expect(f.stitched()).toMatchObject({ width: 4096, height: 2048 })
    expect(f.stitched()?.tiles.map((t) => t.row)).not.toContain(0)
    expect(f.closed).toHaveLength(6 * 16)
  })

  it('still fails the whole image when a tile inside coverage fails', async () => {
    const f = fakeIo((url) => url.endsWith('/3/1/0.png'))
    const result = await loadLayerImage(thermal, 3, signal(), f.io)
    expect(result.status).toBe('error')
    expect(f.stitched()).toBeNull()
  })

  it('turns one failed tile into an error for the whole layer', async () => {
    const f = fakeIo((url) => url.endsWith('/0/1.png'))
    const result = await loadLayerImage(coarse, 1, signal(), f.io)
    expect(result).toEqual({
      status: 'error',
      reason: 'Geology (USGS global geologic map) failed to load: The tile server returned 404 for a tile',
    })
    expect(f.stitched()).toBeNull()
    expect(f.closed).toHaveLength(7)
  })

  it('refuses to upscale past the source’s maximum zoom', async () => {
    const f = fakeIo()
    const result = await loadLayerImage(coarse, 2, signal(), f.io)
    expect(result).toMatchObject({ status: 'error', reason: expect.stringMatching(/up to zoom 1/) })
    expect(f.requested).toHaveLength(0)
  })

  it('refuses whole-globe zooms past MAX_GLOBE_ZOOM and invalid zooms', async () => {
    const f = fakeIo()
    expect((await loadLayerImage(satellite, MAX_GLOBE_ZOOM + 1, signal(), f.io)).status).toBe('error')
    expect((await loadLayerImage(satellite, -1, signal(), f.io)).status).toBe('error')
    expect(f.requested).toHaveLength(0)
  })

  it('reports an already-cancelled load as an error without fetching', async () => {
    const controller = new AbortController()
    controller.abort()
    const f = fakeIo()
    const result = await loadLayerImage(coarse, 0, controller.signal, f.io)
    expect(result).toEqual({ status: 'error', reason: 'Cancelled' })
    expect(f.requested).toHaveLength(0)
  })
})

describe('loadLayerTile', () => {
  const live = () => new AbortController().signal

  it('fetches one tile and hands back the bitmap unclosed', async () => {
    const f = fakeIo()
    const r = await loadLayerTile(satellite, 5, 3, 7, live(), f.io)
    expect(r.status).toBe('ready')
    expect(f.requested).toEqual([tileUrl(satellite, 5, 3, 7)])
    expect(f.closed).toEqual([])
  })

  it('answers empty for a row outside coverage without a request', async () => {
    const f = fakeIo()
    const r = await loadLayerTile(thermal, 3, 0, 0, live(), f.io)
    expect(r).toEqual({ status: 'empty' })
    expect(f.requested).toEqual([])
  })

  it('refuses a zoom the source does not serve, and an index outside the grid', async () => {
    const f = fakeIo()
    expect((await loadLayerTile({ ...geology, maxZoom: 1 }, 2, 0, 0, live(), f.io)).status).toBe('error')
    expect((await loadLayerTile(satellite, 3, 8, 0, live(), f.io)).status).toBe('error')
    expect((await loadLayerTile(satellite, 3, 0, 16, live(), f.io)).status).toBe('error')
    expect((await loadLayerTile(satellite, 3, 1.5, 0, live(), f.io)).status).toBe('error')
    expect(f.requested).toEqual([])
  })

  it('turns a failed fetch into an error with the layer named', async () => {
    const f = fakeIo(() => true)
    const r = await loadLayerTile(satellite, 4, 1, 1, live(), f.io)
    expect(r).toEqual({
      status: 'error',
      reason: expect.stringMatching(/Satellite .* tile failed to load: The tile server returned 404/),
      retryable: false,
    })
  })

  it('marks a server or network failure retryable, a 404 not', async () => {
    const io = (error: unknown): TileIo => ({
      fetchTile: () => Promise.reject(error),
      stitch: () => {
        throw new Error('unused')
      },
    })
    const retryable = async (e: unknown) => {
      const r = await loadLayerTile(satellite, 4, 1, 1, live(), io(e))
      return r.status === 'error' ? r.retryable : r.status
    }
    expect(await retryable(new TileHttpError(503))).toBe(true)
    expect(await retryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(await retryable(new TileHttpError(404))).toBe(false)
  })

  it('does not fetch when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const f = fakeIo()
    const r = await loadLayerTile(satellite, 4, 1, 1, controller.signal, f.io)
    expect(r).toEqual({ status: 'error', reason: 'Cancelled', retryable: false })
    expect(f.requested).toEqual([])
  })
})
