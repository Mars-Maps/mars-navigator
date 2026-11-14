import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, unavailable, type Classified, type MarsCoordinate, type SurfaceImage } from '../../src/domain'
import { PhotoStrip, type StopPhotos } from '../../src/features/mission-ui/photos/PhotoStrip'
import { NO_PHOTOS_NEAR_STOPS, type PathPhoto } from '../../src/features/mission-ui/photos/photoStripMath'
import { RoverPhotoThumb } from '../../src/features/mission-ui/photos/RoverPhotoThumb'

// Test fixtures only — invented images, sols and positions, never shown in the app.
const AT = derived<MarsCoordinate>({ latitude: 18.4, longitudeEast: 77.5 }, 'fixture-join')
const image = (id: string, sol: number, position: Classified<MarsCoordinate> = AT): SurfaceImage => ({
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
  position,
})
const photo = (id: string, sol: number, approximate = false, position?: Classified<MarsCoordinate>): PathPhoto => ({
  image: image(id, sol, position),
  approximate,
})

const render = (photos: PathPhoto[], stops: StopPhotos[] = [], notReady?: string) =>
  renderToStaticMarkup(<PhotoStrip photos={photos} stops={stops} radiusM={200} notReady={notReady} onGoTo={() => {}} />)

describe('PhotoStrip', () => {
  it('shows the photos oldest sol first, each with sol, camera, credit and a full-size link', () => {
    const html = render([photo('later', 20), photo('first', 10)])
    expect(html.indexOf('first-thumb.jpg')).toBeLessThan(html.indexOf('later-thumb.jpg'))
    expect(html).toContain('>Sol 10<')
    expect(html).toContain('2 photos, oldest sol first')
    expect(html.match(/Credit: fixture-credit/g)).toHaveLength(2)
    expect(html.match(/>Full size<\/a>/g)).toHaveLength(2)
    expect(html).toMatch(/<img[^>]*loading="lazy"/)
  })

  it('makes each picture a button that goes to where it was taken', () => {
    const html = render([photo('a', 1)])
    expect(html).toMatch(/<button type="button" aria-label="Perseverance FIXTURE_CAM, sol 1: go to where it was taken"/)
  })

  it('keeps a photo with no known position, says why, and does not offer to go there', () => {
    const html = render([photo('lost', 1, false, unavailable('fixture-no-rmc'))])
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-label="Perseverance FIXTURE_CAM, sol 1: position unknown, fixture-no-rmc"')
    expect(html).not.toContain('go to where it was taken')
    // Visible too, with the reason in its mark.
    expect(html).toContain('Position unknown')
    expect(html).toContain('UNAVAILABLE')
  })

  it('says "Approximate position" only where the join was approximate', () => {
    expect(render([photo('a', 1, true), photo('b', 2)]).match(/Approximate position/g)).toHaveLength(1)
  })

  it('shows a page at a time, with a button for the next', () => {
    const many = Array.from({ length: 95 }, (_, i) => photo(`p${i}`, i))
    const html = render(many)
    expect(html.match(/<img /g)).toHaveLength(40)
    expect(html).toContain('Showing 40 of 95, oldest sol first')
    expect(html).toContain('>Show 40 more</button>')
  })

  it('offers all stops and each stop as one choice, all stops first', () => {
    const html = render([photo('a', 1)], [
      { label: 'Stop 1', photos: [photo('a', 1)] },
      { label: 'Stop 2', photos: [] },
    ])
    expect(html.match(/type="radio"/g)).toHaveLength(3)
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/>All stops/)
    expect(html).toContain('Near Stop 1')
    expect(html).toContain('Near Stop 2')
  })

  it('offers no choice without stops', () => {
    expect(render([photo('a', 1)])).not.toContain('type="radio"')
  })

  it('says when no photos are placed along the path', () => {
    expect(render([])).toContain('No rover photos placed along this path')
  })

  // A stop's search that did not look everywhere in reach.
  it("with all stops' searches giving reasons, points at them rather than claiming none", () => {
    const html = render([], [
      { label: 'Stop 1', photos: [], reason: 'fixture-no-waypoint' },
      { label: 'Stop 2', photos: [], reason: 'fixture-not-searched' },
    ])
    expect(html).toContain(NO_PHOTOS_NEAR_STOPS.replace("'", '&#x27;'))
    expect(html).toContain('Stop 1: fixture-no-waypoint')
    expect(html).toContain('Stop 2: fixture-not-searched')
    expect(html).not.toContain('No rover photos placed along this path')
  })

  // A stop whose read failed must not look fine beside another stop's photos.
  it('in All stops with photos, still lists each stop that found none, with its reason', () => {
    const html = render([photo('a', 1)], [
      { label: 'Stop 1', photos: [photo('a', 1)] },
      { label: 'Stop 2', photos: [], reason: 'fixture-read-failed' },
    ])
    expect(html).toContain('a-thumb.jpg')
    expect(html).toContain('aria-label="Stops with no photos"')
    expect(html).toContain('Stop 2: fixture-read-failed')
    expect(html).not.toContain('Stop 1:')
  })

  it('lists no stops when every stop found photos', () => {
    const html = render([photo('a', 1)], [{ label: 'Stop 1', photos: [photo('a', 1)] }])
    expect(html).not.toContain('Stops with no photos')
  })

  // The count is of what was read, so the strip says what that was.
  it('says which photos were looked for under the title, and not while they are not ready', () => {
    const strip = (notReady?: string) =>
      renderToStaticMarkup(
        <PhotoStrip photos={[photo('a', 1)]} stops={[]} radiusM={200} notReady={notReady} scope="fixture-scope" onGoTo={() => {}} />,
      )
    expect(strip()).toContain('fixture-scope')
    expect(strip('fixture-loading')).not.toContain('fixture-scope')
  })

  it('while the photos are not there, says why instead of "no photos"', () => {
    const html = render([], [], 'fixture-loading')
    expect(html).toContain('fixture-loading')
    expect(html).not.toContain('No rover photos')
  })
})

describe('RoverPhotoThumb without goTo', () => {
  it('links the picture to the full size, as the stop card shows it', () => {
    const html = renderToStaticMarkup(<RoverPhotoThumb image={image('a', 1)} />)
    expect(html).toMatch(/<a href="https:\/\/example.invalid\/a.jpg" target="_blank" rel="noreferrer" aria-label="Perseverance FIXTURE_CAM, sol 1: open full size in a new tab"/)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('>Full size<')
  })
})
