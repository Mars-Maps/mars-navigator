import { describe, expect, it } from 'vitest'
import {
  featureQueryUrl,
  parseFeatureRings,
  queryFeatureRings,
  type FeatureIo,
} from '../../src/data/adapters/arcgisFeatures'
import { loadLandingEllipse, type EllipseSource } from '../../src/data/adapters/SiteAdapter'
import { DEFAULT_SITE, JEZERO, JEZERO_ELLIPSE, SITES, SIM_3464 } from '../../src/data/sites/sites'
import { boundsSpanDeg, insideBounds, siteProblem, type MissionSite } from '../../src/domain'

describe('MissionSite contract', () => {
  it('Jezero keeps the contract and is the site the app opens on', () => {
    expect(siteProblem(JEZERO)).toBeNull()
    expect(DEFAULT_SITE).toBe(SITES.jezero)
    expect(DEFAULT_SITE.site.id).toBe('jezero')
  })

  it('cites the USGS map by DOI and states where the centre and bounds come from', () => {
    expect(JEZERO.map).toBe(SIM_3464)
    expect(SIM_3464.citation).toMatch(/10\.3133\/sim3464/)
    expect(SIM_3464.scaleDenominator).toBe(75_000)
    expect(JEZERO.source).toMatch(/MapBoundary/)
    expect(JEZERO.source).toMatch(/midpoint of the LandingEllipse/)
    expect(JEZERO.source).toMatch(/2026-10-28/)
    expect(JEZERO_ELLIPSE.citation).toMatch(/10\.3133\/sim3464/)
    expect(JEZERO_ELLIPSE.bounds).toEqual(JEZERO.bounds)
  })

  it('the bounds are the map sheet, verbatim, and the centre lies in the ellipse extent', () => {
    expect(JEZERO.bounds).toEqual({ west: 76.8, east: 77.8, south: 17.7, north: 18.7 })
    expect(insideBounds(JEZERO.centre, { west: 77.354, east: 77.505, south: 18.399, north: 18.534 })).toBe(true)
  })

  it('names every way a site definition can be wrong', () => {
    const bad = (patch: Partial<MissionSite>) => siteProblem({ ...JEZERO, ...patch })
    expect(bad({ bounds: { west: 78, east: 77, south: 17.7, north: 18.7 } })).toMatch(/west < east/)
    expect(bad({ bounds: { west: 76.8, east: 77.8, south: 19, north: 18.7 } })).toMatch(/south < north/)
    expect(bad({ bounds: { west: 76.8, east: 77.8, south: 17.7, north: Number.NaN } })).toMatch(/finite/)
    expect(bad({ centre: { latitude: 18.4, longitudeEast: 10 } })).toMatch(/outside the bounds/)
    expect(bad({ centre: { latitude: 95, longitudeEast: 77.4 } })).toMatch(/valid coordinate/)
    expect(bad({ name: ' ' })).toMatch(/name and source/)
  })

  it('spans the longer side, the east–west one shrunk by the latitude', () => {
    expect(boundsSpanDeg(JEZERO.bounds)).toBeCloseTo(1, 6)
    expect(boundsSpanDeg({ west: 0, east: 10, south: 59, north: 61 })).toBeCloseTo(10 * Math.cos((60 * Math.PI) / 180), 6)
  })
})

describe('arcgisFeatures', () => {
  it('asks for every feature in Mars 2000 degrees', () => {
    const url = featureQueryUrl('https://example.test/FeatureServer/', 2)
    expect(url).toBe('https://example.test/FeatureServer/2/query?where=1%3D1&outFields=*&outSR=104971&f=json')
  })

  it('turns Esri rings into coordinates, longitude normalised to 0–360°E', () => {
    const rings = parseFeatureRings({
      features: [{ geometry: { rings: [[[-100, 10], [-99, 10], [-99, 11]]] } }],
    })
    expect(rings).toEqual([[[
      { latitude: 10, longitudeEast: 260 },
      { latitude: 10, longitudeEast: 261 },
      { latitude: 11, longitudeEast: 261 },
    ]]])
  })

  it('says what is wrong with an answer, and never returns part of one', () => {
    expect(parseFeatureRings(null)).toBe('not a JSON object')
    expect(parseFeatureRings({ error: { message: 'fixture failure' } })).toBe('service error: fixture failure')
    expect(parseFeatureRings({})).toBe('no "features" list')
    expect(parseFeatureRings({ features: [{ geometry: {} }] })).toBe('feature 0 has no polygon rings')
    expect(parseFeatureRings({ features: [{ geometry: { rings: [[[0, 0], [1, 1]]] } }] })).toMatch(/fewer than 3/)
    expect(parseFeatureRings({ features: [{ geometry: { rings: [[[0, 0], [1, 1], [1, 95]]] } }] })).toMatch(/not \[lon, lat\]/)
    expect(parseFeatureRings({ features: [{ geometry: { rings: [[[0, 0], [1, 1], ['1', 2]]] } }] })).toMatch(/not \[lon, lat\]/)
    expect(parseFeatureRings({ features: [] })).toEqual([])
  })

  it('never rejects: a failed fetch is its message, a cancel is Cancelled', async () => {
    const failing: FeatureIo = { fetchJson: async () => Promise.reject(new Error('offline')) }
    expect(await queryFeatureRings('https://example.test/q', new AbortController().signal, failing)).toBe('offline')
    const aborted = new AbortController()
    aborted.abort()
    let asked = false
    const io: FeatureIo = { fetchJson: async () => { asked = true; return { features: [] } } }
    expect(await queryFeatureRings('https://example.test/q', aborted.signal, io)).toBe('Cancelled')
    expect(asked).toBe(false)
  })
})

describe('loadLandingEllipse', () => {
  // Test fixture only: an invented service and ring, never shown in the app.
  const source: EllipseSource = {
    serviceUrl: 'https://example.test/FeatureServer',
    layerId: 2,
    citation: 'fixture-ellipse-citation',
    bounds: { west: 10, east: 12, south: 20, north: 22 },
  }
  const ring = [[10.5, 20.5], [11.5, 20.5], [11.5, 21.5], [10.5, 21.5], [10.5, 20.5]]
  const io = (features: unknown[]): FeatureIo & { urls: string[] } => {
    const urls: string[] = []
    return { urls, fetchJson: async (url) => { urls.push(url); return { features } } }
  }
  const live = () => new AbortController().signal

  it('is OFFICIAL with the citation: the one ring, closed, in order', async () => {
    const f = io([{ geometry: { rings: [ring] } }])
    const result = await loadLandingEllipse(source, live(), f)
    expect(f.urls).toEqual(['https://example.test/FeatureServer/2/query?where=1%3D1&outFields=*&outSR=104971&f=json'])
    expect(result.classification).toBe('OFFICIAL')
    if (result.classification !== 'OFFICIAL') return
    expect(result.source).toBe('fixture-ellipse-citation')
    expect(result.value).toHaveLength(5)
    expect(result.value[0]).toEqual({ latitude: 20.5, longitudeEast: 10.5 })
    expect(result.value[4]).toEqual(result.value[0])
  })

  it('closes a ring the service left open', async () => {
    const result = await loadLandingEllipse(source, live(), io([{ geometry: { rings: [ring.slice(0, 4)] } }]))
    expect(result.classification).toBe('OFFICIAL')
    if (result.classification === 'OFFICIAL') {
      expect(result.value).toHaveLength(5)
      expect(result.value[4]).toEqual(result.value[0])
    }
  })

  it('is UNAVAILABLE with the reason for the wrong count, a second ring, a ring off the site, or a failure', async () => {
    const reason = async (features: unknown[]) => {
      const r = await loadLandingEllipse(source, live(), io(features))
      return r.classification === 'UNAVAILABLE' ? r.reason : 'available'
    }
    expect(await reason([])).toMatch(/expected one feature, got 0/)
    expect(await reason([{ geometry: { rings: [ring] } }, { geometry: { rings: [ring] } }])).toMatch(/got 2/)
    expect(await reason([{ geometry: { rings: [ring, ring] } }])).toMatch(/expected one ring, got 2/)
    expect(await reason([{ geometry: { rings: [[[50, 20.5], [51, 20.5], [51, 21.5]]] } }])).toMatch(/outside the site bounds/)
    const failing: FeatureIo = { fetchJson: async () => Promise.reject(new Error('offline')) }
    expect(await loadLandingEllipse(source, live(), failing)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Landing ellipse failed to load: offline',
    })
  })
})
