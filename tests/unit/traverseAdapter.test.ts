import { describe, expect, it } from 'vitest'
import { toLongitudeEast } from '../../src/data/adapters/coordinates'
import { loadRoverTraverse, parseWaypoints, type JsonIo } from '../../src/data/adapters/TraverseAdapter'
import { TRAVERSE_FEEDS } from '../../src/data/traverse/traverseFeeds'
import type { Classified, RoverTraverse } from '../../src/domain'

// Properties trimmed from the live M20 waypoint feed of 2026-10-31: its
// first waypoint (sol 13, the landing site) and its last (sol 2022). The
// middle one is invented, with the feed's -9999 for its height and tilt.
const FIRST = { RMC: '3_0', site: 3, drive: 0, sol: 13, easting: 4354494.086, northing: 1093299.695, elev_geoid: -2569.91, lon: 77.45088572, lat: 18.44462715, tilt: 1.181965113 }
const NO_DATA = { RMC: '50_120', site: 50, drive: 120, sol: 900, elev_geoid: -9999, lon: 77.3, lat: 18.45, tilt: -9999 }
const LAST = { RMC: '93_0', site: 93, drive: 0, sol: 2022, easting: 4342256.503, northing: 1092764.278, elev_geoid: -1936.366943, elev_radii: -9999, lon: 77.23322287, lat: 18.43559434, tilt: 7.289319877 }

const feed = TRAVERSE_FEEDS.perseverance
const collection = (...properties: object[]) => ({
  type: 'FeatureCollection',
  features: properties.map((p) => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [0, 0] } })),
})
const parse = (...properties: object[]) => parseWaypoints(collection(...properties), feed, 1_000)
const traverse = (r: RoverTraverse | string): RoverTraverse => {
  if (typeof r === 'string') throw new Error(r)
  return r
}
const reasonOf = <T,>(c: Classified<T>) => (c.classification === 'UNAVAILABLE' ? c.reason : 'available')

describe('longitude, east-positive −360..360', () => {
  it('converts 0°, 180°, negative input and the closed edges to 0–360°E', () => {
    expect(toLongitudeEast(0, 'east-signed-360')).toBe(0)
    expect(toLongitudeEast(180, 'east-signed-360')).toBe(180)
    expect(toLongitudeEast(-100, 'east-signed-360')).toBe(260)
    expect(toLongitudeEast(-180, 'east-signed-360')).toBe(180)
    expect(toLongitudeEast(77.45088572, 'east-signed-360')).toBe(77.45088572)
    expect(Object.is(toLongitudeEast(-360, 'east-signed-360'), 0)).toBe(true)
    expect(toLongitudeEast(360, 'east-signed-360')).toBe(0)
    expect(toLongitudeEast(360.1, 'east-signed-360')).toBeNull()
    expect(toLongitudeEast(Number.NaN, 'east-signed-360')).toBeNull()
  })
})

describe('parseWaypoints', () => {
  it('reads every waypoint, oldest first: point count and last sol', () => {
    const t = traverse(parse(FIRST, NO_DATA, LAST))
    expect(t.rover).toBe('perseverance')
    expect(t.source).toBe(feed.url)
    expect(t.retrievedUtcMs).toBe(1_000)
    expect(t.points).toHaveLength(3)
    expect(t.points[t.points.length - 1].sol).toBe(2022)
  })

  it('takes lat/lon, never easting/northing or the geometry, and keeps every field OFFICIAL', () => {
    const [first] = traverse(parse(FIRST)).points
    expect(first.coordinate).toEqual({ latitude: 18.44462715, longitudeEast: 77.45088572 })
    expect(first.rmc).toEqual({ site: 3, drive: 0 })
    expect(first.elevationMeters).toEqual({ classification: 'OFFICIAL', value: -2569.91, source: expect.stringMatching(/MOLA areoid/) })
    expect(first.tiltDegrees.classification === 'OFFICIAL' && first.tiltDegrees.value).toBe(1.181965113)
  })

  it('a -9999 height or tilt is UNAVAILABLE, never a number', () => {
    const point = traverse(parse(NO_DATA)).points[0]
    expect(reasonOf(point.elevationMeters)).toBe('The feed gives no height for this waypoint (-9999)')
    expect(reasonOf(point.tiltDegrees)).toMatch(/no tilt/)
    const { tilt: _tilt, ...noTilt } = FIRST
    expect(reasonOf(traverse(parse(noTilt)).points[0].tiltDegrees)).toBe('The feed gives no tilt for this waypoint')
  })

  it('converts a negative feed longitude to 0–360°E', () => {
    const t = traverse(parse({ ...FIRST, lon: -100 }))
    expect(t.points[0].coordinate.longitudeEast).toBe(260)
  })

  it('rejects the whole feed, with the reason, for one bad or out-of-order waypoint', () => {
    expect(parseWaypoints(null, feed, 0)).toBe('not a GeoJSON FeatureCollection')
    expect(parseWaypoints({ type: 'FeatureCollection', features: [] }, feed, 0)).toBe('the feed lists no waypoints')
    expect(parse(FIRST, { ...LAST, lat: '18.4' })).toBe('waypoint 1 has no numeric lat/lon')
    expect(parse({ ...FIRST, lat: 95 })).toMatch(/position out of range \(latitude-range\)/)
    expect(parse({ ...FIRST, sol: 13.5 })).toBe('waypoint 0 has no sol')
    expect(parse({ ...FIRST, drive: -1, RMC: '3_-1' })).toBe('waypoint 0 has no site/drive')
    expect(parse({ ...FIRST, RMC: '3_1' })).toMatch(/RMC "3_1" disagrees with site 3, drive 0/)
    expect(parse(LAST, FIRST)).toMatch(/waypoint 1 \(3_0, sol 13\) comes before/)
    expect(parse(FIRST, FIRST)).toMatch(/comes before/)
  })
})

describe('loadRoverTraverse', () => {
  const live = () => new AbortController().signal

  it('fetches the rover’s feed live and is OFFICIAL with the credit and URL', async () => {
    const urls: string[] = []
    const io: JsonIo = { fetchJson: async (url) => { urls.push(url); return collection(FIRST, LAST) } }
    const result = await loadRoverTraverse('curiosity', live(), io, () => 42)
    expect(urls).toEqual(['https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json'])
    expect(result.classification).toBe('OFFICIAL')
    if (result.classification !== 'OFFICIAL') return
    expect(result.source).toBe(`${TRAVERSE_FEEDS.curiosity.credit}, ${TRAVERSE_FEEDS.curiosity.url}`)
    expect(result.value.rover).toBe('curiosity')
    expect(result.value.retrievedUtcMs).toBe(42)
  })

  it('each rover’s height names its own datum check, and tilt says no SIS definition was verified', async () => {
    const io: JsonIo = { fetchJson: async () => collection(FIRST, LAST) }
    const msl = await loadRoverTraverse('curiosity', live(), io)
    const m20 = await loadRoverTraverse('perseverance', live(), io)
    if (msl.classification !== 'OFFICIAL' || m20.classification !== 'OFFICIAL') throw new Error('expected OFFICIAL')
    const sourceOf = (v: { classification: string; source?: string }) => v.source
    expect(sourceOf(msl.value.points[0].elevationMeters)).toMatch(/Bradbury Landing.*within 3 m/)
    // Shown in the app: no tracker number a reader cannot look up.
    expect(sourceOf(msl.value.points[0].elevationMeters)).not.toMatch(/#\d/)
    expect(sourceOf(m20.value.points[0].elevationMeters)).toMatch(/Mars 2020 PLACES SIS §3\.9\.3/)
    expect(sourceOf(msl.value.points[0].elevationMeters)).not.toMatch(/Mars 2020 PLACES SIS/)
    expect(sourceOf(msl.value.points[0].tiltDegrees)).toMatch(/no PLACES SIS definition was verified/)
  })

  it('a failed fetch, a bad feed or a cancel is UNAVAILABLE with the reason', async () => {
    const failing: JsonIo = { fetchJson: async () => Promise.reject(new Error('HTTP 503')) }
    expect(await loadRoverTraverse('perseverance', live(), failing)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'NASA/JPL-Caltech, Mars 2020 rover waypoints failed to load: HTTP 503',
    })
    const bad: JsonIo = { fetchJson: async () => ({ features: 'none' }) }
    expect(reasonOf(await loadRoverTraverse('perseverance', live(), bad))).toMatch(/not a GeoJSON FeatureCollection/)
    const aborted = new AbortController()
    aborted.abort()
    let asked = false
    const io: JsonIo = { fetchJson: async () => { asked = true; return collection(FIRST) } }
    expect(reasonOf(await loadRoverTraverse('perseverance', aborted.signal, io))).toMatch(/Cancelled$/)
    expect(asked).toBe(false)
  })
})
