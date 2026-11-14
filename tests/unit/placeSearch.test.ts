import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { altitudeToFrame } from '../../src/features/mars-3d/framing'
import { FRAME_MIN_ALTITUDE_KM } from '../../src/features/mars-3d/constants'
import { parsePlaceNames, type PlaceName } from '../../src/data/adapters/PlaceNamesAdapter'
import { unavailable, type SurfacePoint } from '../../src/domain'
import {
  MARKER_TYPE,
  MAX_RESULTS,
  featureSpanDeg,
  matchRank,
  normalizeName,
  searchPlaces,
  typeCounts,
  type Place,
} from '../../src/features/mission-ui/search/placeSearch'

// Test fixtures only: invented names and points, never shown in the app.
const place = (featureId: number, name: string, diameterKm: number | null, type = 'Crater'): Place => ({
  featureId,
  name,
  type,
  coordinate: { latitude: 10, longitudeEast: 20 },
  diameterKm,
})
const PLACES = [place(1, 'Fixture Mons', 600, 'Mons'), place(2, 'Fixtureland', 30), place(3, 'Big Fixture', 900), place(4, 'Ñixtüre', 5)]
const MARKERS: SurfacePoint[] = [
  { id: 'm1', coordinate: { latitude: -1, longitudeEast: 2 }, label: 'fixture camp', elevationMeters: unavailable('fixture') },
]

describe('place names from the Gazetteer extract', () => {
  const committed = JSON.parse(readFileSync('src/data/places/marsNames.json', 'utf8')) as unknown

  it('reads the committed extract whole, OFFICIAL with the Gazetteer cited', () => {
    const read = parsePlaceNames(committed)
    expect(read.classification).toBe('OFFICIAL')
    if (read.classification !== 'OFFICIAL') return
    expect(read.source).toMatch(/USGS Gazetteer of Planetary Nomenclature.*retrieved \d{4}-\d{2}-\d{2}/)
    expect(read.value.length).toBeGreaterThan(2000)
    // The same record the measured-temperature lookup cites for Jezero (feature 14300).
    const jezero = read.value.find((p) => p.name === 'Jezero') as PlaceName
    expect(jezero).toMatchObject({ featureId: 14300, type: 'Crater' })
    expect(jezero.coordinate.latitude).toBeCloseTo(18.41, 2)
    expect(jezero.coordinate.longitudeEast).toBeCloseTo(77.69, 2)
  })

  it('is unavailable as a whole when any row is wrong, never partial', () => {
    const good = committed as { rows: unknown[][] }
    const bad = { ...good, rows: [...good.rows, ['Bad', 'Crater', 95, 10, 1, 1]] }
    const read = parsePlaceNames(bad)
    expect(read).toEqual({ classification: 'UNAVAILABLE', reason: 'Place names: Bad: centre out of range' })
    expect(parsePlaceNames({ ...good, columns: ['name'] }).classification).toBe('UNAVAILABLE')
    expect(parsePlaceNames(null).classification).toBe('UNAVAILABLE')
  })

  it('gives each feature id once: an exact repeat is dropped, a conflicting one is refused', () => {
    const good = committed as { rows: unknown[][] }
    const read = parsePlaceNames(committed)
    if (read.classification !== 'OFFICIAL') throw new Error(read.classification)
    const ids = read.value.map((p) => p.featureId)
    expect(new Set(ids).size).toBe(ids.length)
    const row = ['Fixture', 'Crater', 10, 20, 5, 1]
    const twice = parsePlaceNames({ ...good, rows: [row, [...row]] })
    expect(twice.classification === 'OFFICIAL' && twice.value).toHaveLength(1)
    expect(parsePlaceNames({ ...good, rows: [row, ['Other', 'Crater', 10, 20, 5, 1]] })).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Place names: feature 1 has two different rows',
    })
  })

  it('wraps the 360°E the Gazetteer gives a few albedo features to 0°E', () => {
    const good = committed as { rows: unknown[][] }
    const read = parsePlaceNames({ ...good, rows: [['Fixture', 'Albedo Feature', 10, 360, null, 1]] })
    expect(read.classification === 'OFFICIAL' && read.value[0]?.coordinate.longitudeEast).toBe(0)
  })
})

describe('Search & Go To matching', () => {
  it('ignores case and accents', () => {
    expect(normalizeName('  Ñixtüre  Mons ')).toBe('nixture mons')
  })

  it('ranks exact, prefix, word start, then anywhere', () => {
    expect(matchRank('Fixture Mons', 'fixture mons')).toBe(0)
    expect(matchRank('Fixture Mons', 'fix')).toBe(1)
    expect(matchRank('Big Fixture', 'fix')).toBe(2)
    expect(matchRank('Bigfixture', 'fix')).toBe(3)
    expect(matchRank('Fixture', 'zzz')).toBeNull()
  })

  // The rows only, for the tests that look at what is listed.
  const rows = (...args: Parameters<typeof searchPlaces>) => searchPlaces(...args).results

  it('lists marked points first among equal matches, then larger features', () => {
    expect(rows('fix', PLACES, MARKERS).map((r) => r.title)).toEqual(['fixture camp', 'Fixture Mons', 'Fixtureland', 'Big Fixture'])
    expect(rows('fixture', PLACES, MARKERS).map((r) => r.kind)).toEqual(['marker', 'place', 'place', 'place'])
    expect(rows('nix', PLACES, [])[0]?.title).toBe('Ñixtüre')
  })

  it('offers a typed coordinate first, and lists nothing for nothing typed', () => {
    const [first] = rows('18.4, 77.7', PLACES, [])
    expect(first).toMatchObject({ kind: 'coordinate', coordinate: { latitude: 18.4, longitudeEast: 77.7 }, diameterKm: null })
    expect(searchPlaces('   ', PLACES, MARKERS)).toEqual({ results: [], total: 0 })
  })

  it('lists up to the cap and counts every match, so the panel can say there are more', () => {
    const many = Array.from({ length: MAX_RESULTS + 20 }, (_, i) => place(100 + i, `Fixture ${i}`, i + 1))
    const answer = searchPlaces('fixture', many, [])
    expect(answer.results).toHaveLength(MAX_RESULTS)
    expect(answer.total).toBe(MAX_RESULTS + 20)
    expect(searchPlaces('fixture', many, [], null, 5).results).toHaveLength(5)
  })

  it('a type filter keeps one kind of feature, or only the marked points', () => {
    expect(rows('fix', PLACES, MARKERS, 'Crater').map((r) => r.title)).toEqual(['Fixtureland', 'Big Fixture'])
    expect(rows('fix', PLACES, MARKERS, 'Mons').map((r) => r.title)).toEqual(['Fixture Mons'])
    expect(rows('fix', PLACES, MARKERS, MARKER_TYPE).map((r) => r.kind)).toEqual(['marker'])
    // A typed coordinate is not a feature type.
    expect(rows('18.4, 77.7', PLACES, [], 'Crater')).toEqual([])
  })

  it('a type with nothing typed lists all of that type, largest first', () => {
    expect(rows('', PLACES, MARKERS, 'Crater').map((r) => r.title)).toEqual(['Big Fixture', 'Fixtureland', 'Ñixtüre'])
    expect(searchPlaces('', PLACES, MARKERS, MARKER_TYPE).total).toBe(1)
  })

  it('offers each type with its count, most common first, then the marked points', () => {
    expect(typeCounts(PLACES, 1)).toEqual([
      { type: 'Crater', count: 3 },
      { type: 'Mons', count: 1 },
      { type: MARKER_TYPE, count: 1 },
    ])
    expect(typeCounts(PLACES, 0).map((t) => t.type)).not.toContain(MARKER_TYPE)
  })

  it('a place says its type, size and centre', () => {
    expect(rows('fixture mons', PLACES, [])[0]?.detail).toBe('Mons · 600 km across · 10.0°N 20.0°E')
    expect(rows('fixtureland', PLACES, [])[0]?.detail).toBe('Crater · 30.0 km across · 10.0°N 20.0°E')
  })

  it('Go to frames a feature by its diameter, small ones at the lowest a flight frames', () => {
    expect(featureSpanDeg(Math.PI * 3389.5)).toBeCloseTo(180, 6)
    expect(altitudeToFrame(featureSpanDeg(1))).toBe(FRAME_MIN_ALTITUDE_KM)
    expect(altitudeToFrame(featureSpanDeg(3000))).toBeGreaterThan(altitudeToFrame(featureSpanDeg(600)))
  })
})
