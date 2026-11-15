import { describe, expect, it } from 'vitest'
import { extentQueryUrl, parseFeatureList, pointQueryUrl, readPaths, readPoint, toSignedLongitude, type FeatureIo } from '../../src/data/adapters/arcgisFeatures'
import { geologicFeatures, geologicUnitAreas, geologicUnitAt } from '../../src/data/adapters/GeologyAdapter'
import { JEZERO_UNITS, SIM_3292 } from '../../src/data/geology/geologySources'
import { JEZERO, SIM_3464 } from '../../src/data/sites/sites'
import type { Classified } from '../../src/domain'

// Attributes trimmed from the live USGS answers of 2026-10-31: SIM 3464 at
// the landing site (77.4508°E, 18.4447°N) and SIM 3292 at Gale (137.4°E,
// 5.4°S). Geometry is a small invented square, never shown in the app.
const JEZERO_FLOOR = {
  unit: '2',
  name: 'Jezero floor unit',
  symbol: 'Njf',
  Unit_Description: 'Rugged, moderately-to-heavily cratered, light- to dark-toned, planar unit',
  Unit_Interpretation: 'Volcanic ash or eolian airfall deposit that drapes underlying topography.',
}
const RIIM = { unit: '11', name: 'Crater riim unit', symbol: 'cr' }
const GALE = { Unit: 'Htu', UnitDesc: 'Hesperian transition undivided unit' }
const square = [[77.4, 18.4], [77.5, 18.4], [77.5, 18.5], [77.4, 18.5], [77.4, 18.4]]

const LANDING = { latitude: 18.4447, longitudeEast: 77.4508 }
const GALE_POINT = { latitude: -5.4, longitudeEast: 137.4 }
const NEAR_LANDING = { west: 77.3, east: 77.6, south: 18.35, north: 18.6 }

type Route = (url: string) => unknown
const fixtureIo = (route: Route): FeatureIo & { urls: string[] } => {
  const urls: string[] = []
  return { urls, fetchJson: async (url) => { urls.push(url); return route(url) } }
}
const live = () => new AbortController().signal
const features = (...attributes: object[]) => ({ features: attributes.map((a) => ({ attributes: a })) })
const reasonOf = <T,>(c: Classified<T>) => (c.classification === 'UNAVAILABLE' ? c.reason : 'available')

describe('arcgisFeatures point and extent queries', () => {
  it('sends longitude as ±180°, the only way the services read it', () => {
    expect(toSignedLongitude(77.45)).toBe(77.45)
    expect(toSignedLongitude(180)).toBe(180)
    expect(toSignedLongitude(226.2)).toBeCloseTo(-133.8, 9)
    const url = new URL(pointQueryUrl('https://example.test/MapServer/', 0, { latitude: 18.65, longitudeEast: 226.2 }, ['Unit']))
    expect(url.pathname).toBe('/MapServer/0/query')
    expect(url.searchParams.get('geometry')).toMatch(/^-133\.8\d*,18\.65$/)
    expect(url.searchParams.get('inSR')).toBe('104905')
    expect(url.searchParams.get('returnGeometry')).toBe('false')
  })

  it('asks for a box in degrees, simplified when told to, and refuses one across 180°E', () => {
    const url = new URL(extentQueryUrl('https://example.test/FS', 8, NEAR_LANDING, ['name'], 0.0005) ?? '')
    expect(url.searchParams.get('geometry')).toBe('77.3,18.35,77.6,18.6')
    expect(url.searchParams.get('outSR')).toBe('104971')
    expect(url.searchParams.get('maxAllowableOffset')).toBe('0.0005')
    expect(extentQueryUrl('https://example.test/FS', 8, { west: 170, east: 190, south: 0, north: 1 }, ['name'])).toBeNull()
  })

  it('reads lines and points into 0–360°E, and says what is wrong with them', () => {
    expect(readPaths({ paths: [[[-100, 10], [-99, 11]]] }, 0)).toEqual([[
      { latitude: 10, longitudeEast: 260 },
      { latitude: 11, longitudeEast: 261 },
    ]])
    expect(readPaths({ paths: [[[0, 0]]] }, 3)).toBe('feature 3 path 0 has fewer than 2 vertices')
    expect(readPaths({}, 1)).toBe('feature 1 has no polyline paths')
    expect(readPoint({ x: -100, y: 10 }, 0)).toEqual({ latitude: 10, longitudeEast: 260 })
    expect(readPoint({ x: 1, y: 95 }, 2)).toBe('feature 2 has a point that is not x, y in range')
  })
})

describe('geologicUnitAt', () => {
  it('the landing site is the Jezero floor unit, OFFICIAL with the SIM 3464 citation', async () => {
    const io = fixtureIo(() => features(JEZERO_FLOOR))
    const unit = await geologicUnitAt(LANDING, live(), io)
    expect(io.urls).toHaveLength(1)
    expect(io.urls[0]).toContain('Jezero_FeatureServiceFromPro/FeatureServer/8/query')
    expect(new URL(io.urls[0]).searchParams.get('inSR')).toBe('104905')
    expect(unit).toEqual({
      classification: 'OFFICIAL',
      source: SIM_3464.citation,
      value: {
        symbol: 'Njf',
        name: 'Jezero floor unit',
        description: JEZERO_FLOOR.Unit_Description,
        interpretation: JEZERO_FLOOR.Unit_Interpretation,
        map: SIM_3464,
      },
    })
  })

  it('a point off the Jezero sheet falls back to SIM 3292, without asking SIM 3464', async () => {
    const io = fixtureIo(() => features(GALE))
    const unit = await geologicUnitAt(GALE_POINT, live(), io)
    expect(io.urls).toHaveLength(1)
    expect(io.urls[0]).toContain('SIM3292_Global_Geology/MapServer/0/query')
    expect(unit).toEqual({
      classification: 'OFFICIAL',
      source: SIM_3292.citation,
      value: { symbol: 'Htu', name: 'Hesperian transition undivided unit', map: SIM_3292 },
    })
  })

  it('falls back to SIM 3292 where the sheet maps nothing', async () => {
    const io = fixtureIo((url) => (url.includes('SIM3292') ? features(GALE) : features()))
    const unit = await geologicUnitAt(LANDING, live(), io)
    expect(io.urls).toHaveLength(2)
    expect(unit.classification === 'OFFICIAL' && unit.value.map).toBe(SIM_3292)
  })

  it('keeps the source text as published, typo included', async () => {
    const unit = await geologicUnitAt(LANDING, live(), fixtureIo(() => features(RIIM)))
    expect(unit.classification === 'OFFICIAL' && unit.value.name).toBe('Crater riim unit')
    expect(unit.classification === 'OFFICIAL' && unit.value.description).toBeUndefined()
  })

  it('a failed request is UNAVAILABLE, never an empty unit, and never the coarse map instead', async () => {
    const failing: FeatureIo = { fetchJson: async () => Promise.reject(new Error('offline')) }
    expect(await geologicUnitAt(LANDING, live(), failing)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Geologic unit (SIM 3464) failed to load: offline',
    })
    const serviceError = fixtureIo(() => ({ error: { message: 'Invalid query parameters.' } }))
    expect(reasonOf(await geologicUnitAt(LANDING, live(), serviceError))).toMatch(/SIM 3464.*Invalid query/)
    expect(serviceError.urls).toHaveLength(1)
  })

  it('is UNAVAILABLE for a record without a name, a point no map covers, or a point on a contact', async () => {
    expect(reasonOf(await geologicUnitAt(LANDING, live(), fixtureIo(() => features({ symbol: 'Njf', name: ' ' })))))
      .toMatch(/no unit name/)
    expect(reasonOf(await geologicUnitAt(GALE_POINT, live(), fixtureIo(() => features()))))
      .toBe('No geologic map covers this point')
    expect(reasonOf(await geologicUnitAt(LANDING, live(), fixtureIo(() => features(JEZERO_FLOOR, RIIM)))))
      .toMatch(/On a contact between Jezero floor unit \(Njf\) and Crater riim unit \(cr\)/)
    const twice = await geologicUnitAt(LANDING, live(), fixtureIo(() => features(JEZERO_FLOOR, JEZERO_FLOOR)))
    expect(twice.classification).toBe('OFFICIAL')
  })
})

describe('geologicUnitAreas', () => {
  it('returns each polygon with its unit, simplified, and says so in the source', async () => {
    const io = fixtureIo(() => ({ features: [{ attributes: RIIM, geometry: { rings: [square] } }] }))
    const areas = await geologicUnitAreas(NEAR_LANDING, live(), io)
    expect(new URL(io.urls[0]).searchParams.get('maxAllowableOffset')).toBe('0.0005')
    expect(areas.classification).toBe('OFFICIAL')
    if (areas.classification !== 'OFFICIAL') return
    expect(areas.source).toContain(SIM_3464.citation)
    expect(areas.source).toMatch(/simplified .* 0\.0005°/)
    expect(areas.value).toHaveLength(1)
    expect(areas.value[0].unit).toEqual({ symbol: 'cr', name: 'Crater riim unit', map: SIM_3464 })
    expect(areas.value[0].rings[0][0]).toEqual({ latitude: 18.4, longitudeEast: 77.4 })
  })

  it('never returns part of a layer: a cut-short or malformed answer is UNAVAILABLE', async () => {
    const cut = fixtureIo(() => ({ exceededTransferLimit: true, features: [] }))
    expect(reasonOf(await geologicUnitAreas(JEZERO.bounds, live(), cut))).toMatch(/cut the answer short/)
    const noRings = fixtureIo(() => ({ features: [{ attributes: RIIM, geometry: {} }] }))
    expect(reasonOf(await geologicUnitAreas(NEAR_LANDING, live(), noRings))).toMatch(/no polygon rings/)
  })

  it('a box off the sheet is UNAVAILABLE without a request', async () => {
    const io = fixtureIo(() => features())
    expect(reasonOf(await geologicUnitAreas({ west: 137, east: 138, south: -6, north: -5 }, live(), io)))
      .toBe('The box lies outside the SIM 3464 map sheet')
    expect(io.urls).toHaveLength(0)
  })
})

describe('geologicFeatures', () => {
  const layers = (url: string) => {
    if (url.includes('/4/query')) return { features: [{ attributes: { TYPE: 'small crater' }, geometry: { x: 77.45, y: 18.45 } }] }
    if (url.includes('/6/query')) {
      return { features: [{ attributes: { TYPE: 'ridge crest (type 1), certain' }, geometry: { paths: [[[77.4, 18.4], [77.5, 18.5]], [[77.41, 18.4], [77.42, 18.41]]] } }] }
    }
    return { features: [{ attributes: { TYPE: 'dark-colored mantling material' }, geometry: { rings: [square] } }] }
  }

  it('reads points, lines and areas with their kinds verbatim, unsimplified; a multi-part line is several lines', async () => {
    const io = fixtureIo(layers)
    const result = await geologicFeatures(NEAR_LANDING, live(), io)
    expect(io.urls).toHaveLength(3)
    for (const url of io.urls) expect(new URL(url).searchParams.has('maxAllowableOffset')).toBe(false)
    expect(result.classification).toBe('OFFICIAL')
    if (result.classification !== 'OFFICIAL') return
    expect(result.source).toBe(SIM_3464.citation)
    expect(result.value.points).toEqual([{ kind: 'small crater', at: { latitude: 18.45, longitudeEast: 77.45 }, map: SIM_3464 }])
    expect(result.value.lines.map((l) => l.kind)).toEqual(['ridge crest (type 1), certain', 'ridge crest (type 1), certain'])
    expect(result.value.areas[0].kind).toBe('dark-colored mantling material')
    // The sheet the features come from: a route scan reads it to tell "nothing marked" from "not mapped".
    expect(result.value.covers).toEqual(JEZERO_UNITS.sheet)
  })

  it('all three layers or none', async () => {
    const io = fixtureIo((url) => (url.includes('/6/query') ? { error: { message: 'busy' } } : layers(url)))
    expect(reasonOf(await geologicFeatures(NEAR_LANDING, live(), io))).toBe('Mapped features failed to load: service error: busy')
    const noKind = fixtureIo((url) => (url.includes('/4/query') ? { features: [{ attributes: {}, geometry: { x: 77.45, y: 18.45 } }] } : layers(url)))
    expect(reasonOf(await geologicFeatures(NEAR_LANDING, live(), noKind))).toMatch(/points: feature 0 has no TYPE/)
  })

  it('a box off the sheet is UNAVAILABLE without a request', async () => {
    const io = fixtureIo(layers)
    expect(reasonOf(await geologicFeatures({ west: 137, east: 138, south: -6, north: -5 }, live(), io)))
      .toBe('The box lies outside the SIM 3464 map sheet')
    expect(io.urls).toHaveLength(0)
  })
})

describe('parseFeatureList', () => {
  it('a feature whose attributes are not an object reads as one with none', () => {
    const list = parseFeatureList({ features: [{ attributes: 'Njf', geometry: { rings: [square] } }] })
    expect(typeof list === 'string' ? list : list[0].attributes).toEqual({})
    expect(parseFeatureList({ features: [42] })).toBe('feature 0 is not an object')
  })

  it('a unit record with attributes that are not an object is UNAVAILABLE, not a nameless unit', async () => {
    const io = fixtureIo(() => ({ features: [{ attributes: null, geometry: { rings: [square] } }] }))
    expect(reasonOf(await geologicUnitAreas(NEAR_LANDING, live(), io))).toMatch(/feature 0 has no unit symbol/)
  })
})
