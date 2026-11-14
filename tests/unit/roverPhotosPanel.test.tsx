import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  derived,
  SUITED_SLOPE_LIMIT,
  unavailable,
  type MarsCoordinate,
  type SurfaceImage,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import { PHOTOS_NOT_LOADED_REASON, STOP_PHOTO_RADIUS_M, stopPhotos } from '../../src/features/mission-ui/photos/photoStripMath'
import { RoverPhotosPanel } from '../../src/features/mission-ui/photos/RoverPhotosPanel'

// Test fixtures only: invented photos and an invented walk, never shown in the app.
// A server render reads the stores' initial state (no walk plan), so the stop
// filters are tested through `stopPhotos`, which the panel calls.
const image = (id: string, sol: number, at: MarsCoordinate): SurfaceImage => ({
  id,
  rover: 'perseverance',
  sol,
  camera: 'FIXTURE_CAM',
  takenUtcMs: unavailable('fixture'),
  takenLocalMeanSolarTime: unavailable('fixture'),
  rmc: unavailable('fixture'),
  thumbnailUrl: `https://example.invalid/${id}-thumb.jpg`,
  fullUrl: `https://example.invalid/${id}.jpg`,
  credit: 'fixture-credit',
  position: derived(at, 'fixture-join'),
})
const stop = (id: string, lon: number): WalkStop => ({
  id,
  label: `Fixture ${id}`,
  coordinate: { latitude: 18.44, longitudeEast: lon },
  unit: unavailable('fixture'),
  reason: derived('fixture reason', 'fixture method'),
})
const leg = (from: string, to: string): WalkLeg => ({
  fromStopId: from,
  toStopId: to,
  path: unavailable('fixture'),
  distanceKm: unavailable('fixture'),
  steepestSlopeDeg: unavailable('fixture'),
  hazards: unavailable('fixture'),
})
const plan: WalkPlan = {
  goal: { id: 'g', label: 'Fixture goal', unitNames: ['Fixture unit'], reason: derived('fixture', 'fixture') },
  stops: [stop('a', 77.45), stop('b', 77.46)],
  legs: [leg('a', 'b')],
  slopeLimit: SUITED_SLOPE_LIMIT,
}

describe('RoverPhotosPanel', () => {
  it('with no photos from the shell, says they are not loaded, never that there are none', () => {
    const html = renderToStaticMarkup(<RoverPhotosPanel images={null} />)
    expect(html).toContain(PHOTOS_NOT_LOADED_REASON)
    expect(html).not.toContain('No rover photos')
    expect(html).not.toContain('<img')
  })

  it("passes the shell's own reason through when it gives one", () => {
    const html = renderToStaticMarkup(<RoverPhotosPanel images={null} unavailableReason="fixture feed failed" />)
    expect(html).toContain('fixture feed failed')
  })

  it("shows the whole path's photos oldest sol first, with no stop filters before a walk is planned", () => {
    const images = [image('p1', 12, plan.stops[0].coordinate), image('p2', 10, plan.stops[1].coordinate)]
    const html = renderToStaticMarkup(<RoverPhotosPanel images={images} />)
    expect(html).toContain('2 photos, oldest sol first')
    expect(html.indexOf('p2-thumb.jpg')).toBeLessThan(html.indexOf('p1-thumb.jpg'))
    expect(html).not.toContain('Near ')
  })

  it('with photos read but none placed, says so for the path rather than "not loaded"', () => {
    const html = renderToStaticMarkup(<RoverPhotosPanel images={[]} />)
    expect(html).toContain('No rover photos placed along this path')
    expect(html).not.toContain(PHOTOS_NOT_LOADED_REASON)
  })
})

// The stops are about 560 m apart (0.01° of longitude at 18.44° N), so a
// photo at one stop is far outside the other's 250 m.
describe('stopPhotos', () => {
  it('gives each stop, in walking order, only the photos within the radius', () => {
    const images = [image('at-a', 10, plan.stops[0].coordinate), image('at-b', 11, plan.stops[1].coordinate)]
    const near = stopPhotos(plan.stops, images, STOP_PHOTO_RADIUS_M)
    expect(near.map((s) => s.label)).toEqual(['Fixture a', 'Fixture b'])
    expect(near[0].photos.map((p) => p.image.id)).toEqual(['at-a'])
    expect(near[1].photos.map((p) => p.image.id)).toEqual(['at-b'])
  })

  it('keeps a stop with no photos near it, so its filter can say so', () => {
    const near = stopPhotos(plan.stops, [image('at-a', 10, plan.stops[0].coordinate)], STOP_PHOTO_RADIUS_M)
    expect(near[1].photos).toEqual([])
  })

  it("keeps a stop's search reason only when it found nothing there", () => {
    const images = [image('at-a', 10, plan.stops[0].coordinate)]
    const near = stopPhotos(plan.stops, images, STOP_PHOTO_RADIUS_M, ['fixture-ignored', 'fixture-no-waypoint'])
    expect(near[0]).not.toHaveProperty('reason')
    expect(near[1].reason).toBe('fixture-no-waypoint')
  })

  it('without reasons, an empty stop has none, so the strip says "none within"', () => {
    expect(stopPhotos(plan.stops, [], STOP_PHOTO_RADIUS_M)[1]).not.toHaveProperty('reason')
  })

  it('matches the stop card on what "near" means', () => {
    expect(STOP_PHOTO_RADIUS_M).toBe(250)
  })
})
