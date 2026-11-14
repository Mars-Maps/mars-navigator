import { describe, expect, it } from 'vitest'
import {
  groundDetailAt,
  loadLayerTile,
  servedResolution,
  tileInCoverage,
  validateGroundDetail,
  type TileIo,
} from '../../src/data/adapters/LayerAdapter'
import {
  CTX_GROUND_DETAIL,
  GROUND_DETAIL_SOURCES,
  JEZERO_CTX_GROUND_DETAIL as jezCtx,
  JEZERO_HIRISE_GROUND_DETAIL as hirise,
} from '../../src/data/layers/groundDetailSources'

// Trek grid column and row holding a point at `zoom` (2^(z+1) × 2^z tiles from 180°W, 90°N).
const colAt = (zoom: number, lonEast: number) => Math.floor(((lonEast + 180) / 360) * 2 ** (zoom + 1))
const rowAt = (zoom: number, lat: number) => Math.floor(((90 - lat) / 180) * 2 ** zoom)

function fakeIo() {
  const requested: string[] = []
  const io: TileIo = {
    async fetchTile(url) {
      requested.push(url)
      return { close: () => {} } as unknown as ImageBitmap
    },
    stitch: () => ({}) as HTMLCanvasElement,
  }
  return { io, requested }
}

describe('Jezero HiRISE ground detail', () => {
  it('is a valid OFFICIAL record with the box, zooms and tile size Trek states', () => {
    expect(validateGroundDetail(hirise)).toBeNull()
    expect(hirise.classification).toBe('OFFICIAL')
    expect(hirise.sourceResolution).toMatchObject({ classification: 'OFFICIAL', value: '0.25 m/px' })
    expect(hirise.maxZoom).toBe(17)
    expect(hirise.tilePx).toBe(256)
    expect(hirise.coverage).toEqual({ south: 18.3067994, north: 18.669315, west: 77.2229331, east: 77.583964 })
    expect(hirise.caveat).toMatch(/transparent/)
    // The product page asks that its authors be cited.
    expect(hirise.credit).toMatch(/Fergason, Hare, Mayer et al\. 2020/)
    expect(GROUND_DETAIL_SOURCES).toEqual([hirise, jezCtx, CTX_GROUND_DETAIL])
  })

  it('builds the tile URL a fetch on 2026-10-28 answered with a grey tile', () => {
    expect(hirise.tileUrl(17, 52071, 187432)).toBe(
      'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd' +
        '/1.0.0/default/default028mm/17/52071/187432.png',
    )
    expect([rowAt(17, 18.49), colAt(17, 77.4)]).toEqual([52071, 187432])
  })

  it('serves about 0.32 m/px at zoom 17, not a rounded 0 m/px', () => {
    const z17 = servedResolution(17, hirise.tilePx)
    expect(z17.classification === 'DERIVED' && z17.value).toBe('≈ 0.32 m/px at the equator (186413.5 px/deg)')
  })

  it('takes a tile by its column as well as its row', () => {
    const row = rowAt(17, 18.49)
    expect(tileInCoverage(hirise, 17, row, colAt(17, 77.4))).toBe(true)
    // Straddling the west edge: part of it is in the box.
    expect(tileInCoverage(hirise, 17, row, colAt(17, 77.2229331))).toBe(true)
    expect(tileInCoverage(hirise, 17, row, colAt(17, 77.2229331) - 1)).toBe(false)
    expect(tileInCoverage(hirise, 17, row, colAt(17, 77.8))).toBe(false)
    expect(tileInCoverage(hirise, 17, rowAt(17, 18.8), colAt(17, 77.4))).toBe(false)
    // A global source has no longitude bounds.
    expect(tileInCoverage(CTX_GROUND_DETAIL, 11, 0, 0)).toBe(true)
  })

  it('does not request a tile outside the box, which Trek answers with 404', async () => {
    const f = fakeIo()
    const live = new AbortController().signal
    const outside = await loadLayerTile(hirise, 17, rowAt(17, 18.49), colAt(17, 77.8), live, f.io)
    expect(outside).toEqual({ status: 'empty' })
    expect(f.requested).toEqual([])
    const inside = await loadLayerTile(hirise, 17, 52071, 187432, live, f.io)
    expect(inside.status).toBe('ready')
    expect(f.requested).toEqual([hirise.tileUrl(17, 52071, 187432)])
    const z18 = await loadLayerTile(hirise, 18, 0, 0, live, f.io)
    expect(z18.status).toBe('error')
  })

  it('rejects a longitude box that is half given, reversed or off the grid', () => {
    const { west: _w, ...noWest } = hirise.coverage
    expect(validateGroundDetail({ ...hirise, coverage: noWest })).toMatch(/longitude/)
    expect(validateGroundDetail({ ...hirise, coverage: { ...hirise.coverage, west: 78, east: 77 } })).toMatch(
      /longitude/,
    )
    expect(validateGroundDetail({ ...hirise, coverage: { ...hirise.coverage, east: 200 } })).toMatch(/longitude/)
  })
})

describe('Jezero CTX ground detail', () => {
  it('is a valid OFFICIAL record with the box, zooms and tile size Trek states', () => {
    expect(validateGroundDetail(jezCtx)).toBeNull()
    expect(jezCtx.classification).toBe('OFFICIAL')
    expect(jezCtx.sourceResolution).toMatchObject({ classification: 'OFFICIAL', value: '6 m/px' })
    expect(jezCtx.maxZoom).toBe(13)
    expect(jezCtx.tilePx).toBe(256)
    expect(jezCtx.coverage).toEqual({ south: 18.2110274, north: 18.7211945, west: 77.1604655, east: 77.6991776 })
    expect(jezCtx.credit).toMatch(/NASA\/JPL\/MSSS.*Fergason, Hare, Mayer et al\. 2020/)
  })

  it('wraps the HiRISE box, so the fallback under HiRISE gaps is the 6 m mosaic', () => {
    const outer = jezCtx.coverage as Required<typeof jezCtx.coverage>
    const inner = hirise.coverage as Required<typeof hirise.coverage>
    expect(outer.west).toBeLessThan(inner.west)
    expect(outer.east).toBeGreaterThan(inner.east)
    expect(outer.south).toBeLessThan(inner.south)
    expect(outer.north).toBeGreaterThan(inner.north)
  })

  it('serves about 5.1 m/px at zoom 13', () => {
    const z13 = servedResolution(13, jezCtx.tilePx)
    expect(z13.classification === 'DERIVED' && z13.value).toBe('≈ 5.1 m/px at the equator (11650.8 px/deg)')
  })

  it('requests the tiles Trek served on 2026-10-28 and skips the ones it 404ed', async () => {
    // Fetched: 13/3255/11715 → 200; 13/3255/11702 (west) and 13/3242/11715 (north) → 404.
    expect([rowAt(13, 18.47), colAt(13, 77.43)]).toEqual([3255, 11715])
    expect(tileInCoverage(jezCtx, 13, 3255, 11715)).toBe(true)
    expect(tileInCoverage(jezCtx, 13, 3255, 11703)).toBe(true)
    expect(tileInCoverage(jezCtx, 13, 3255, 11702)).toBe(false)
    expect(tileInCoverage(jezCtx, 13, 3243, 11715)).toBe(true)
    expect(tileInCoverage(jezCtx, 13, 3242, 11715)).toBe(false)
    const f = fakeIo()
    const live = new AbortController().signal
    expect((await loadLayerTile(jezCtx, 13, 3255, 11715, live, f.io)).status).toBe('ready')
    expect(f.requested).toEqual([
      'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0' +
        '/1.0.0/default/default028mm/13/3255/11715.png',
    ])
    expect((await loadLayerTile(jezCtx, 14, 0, 0, live, f.io)).status).toBe('error')
  })
})

describe('groundDetailAt', () => {
  it('picks HiRISE in its box, Jezero CTX in the wider box, global CTX elsewhere', () => {
    const inJezero = groundDetailAt({ latitude: 18.44, longitudeEast: 77.45 })
    expect(inJezero.status === 'available' && inJezero.source.id).toBe('jezero-hirise')
    // East of the HiRISE box (77.58°E), inside the CTX one (77.70°E).
    const rim = groundDetailAt({ latitude: 18.44, longitudeEast: 77.65 })
    expect(rim.status === 'available' && rim.source.id).toBe('jezero-ctx')
    const gale = groundDetailAt({ latitude: -5.4, longitudeEast: 137.8 })
    expect(gale.status === 'available' && gale.source.id).toBe('ctx')
  })

  it('matches no source for a NaN coordinate', () => {
    const none = { status: 'unavailable', reason: 'No ground-detail source covers this point' }
    expect(groundDetailAt({ latitude: Number.NaN, longitudeEast: 77.45 })).toEqual(none)
    expect(groundDetailAt({ latitude: 18.44, longitudeEast: Number.NaN })).toEqual(none)
  })

  it('reads 0–360°E: 282.6°E is 77.4°W, far from Jezero', () => {
    const r = groundDetailAt({ latitude: 18.44, longitudeEast: 282.6 })
    expect(r.status === 'available' && r.source.id).toBe('ctx')
  })

  it('falls through a broken record to the next, and names every reason when none is left', () => {
    const broken = { ...hirise, credit: '' }
    const fallback = groundDetailAt({ latitude: 18.44, longitudeEast: 77.45 }, [broken, CTX_GROUND_DETAIL])
    expect(fallback.status === 'available' && fallback.source.id).toBe('ctx')
    expect(groundDetailAt({ latitude: 18.44, longitudeEast: 77.45 }, [broken])).toEqual({
      status: 'unavailable',
      reason: 'HiRISE orthomosaic of Jezero, 25 cm (USGS): No credit line recorded',
    })
    expect(groundDetailAt({ latitude: 0, longitudeEast: 0 }, [hirise])).toEqual({
      status: 'unavailable',
      reason: 'No ground-detail source covers this point',
    })
  })
})
