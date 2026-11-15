import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  HAZARD_NOT_CHECKED,
  RADIATION_HAZARD_UNIT,
  SHIELDING_WARNING_TEXT,
  derived,
  official,
  unavailable,
  type Classified,
  type GeologicUnit,
  type Hazard,
  type SlopeLimit,
  type SurfaceImage,
  SUITED_SLOPE_LIMIT,
} from '../../src/domain'
import { READING_ELEVATION_REASON, READING_SLOPE_REASON } from '../../src/features/mission-ui/pointFields'
import { StopCard } from '../../src/features/mission-ui/stops/StopCard'
import { PHOTOS_NOT_PLACED_REASON } from '../../src/features/mission-ui/stops/stopCardMath'
import { APPROXIMATE_POSITION, photosNear, type PhotoNearby } from '../../src/features/route-analysis/photoPositions'

// Test fixtures only — invented units, heights, slopes and photos, never shown in the app.
const MAP = { id: 'FIXTURE MAP 1', title: 'fixture-map-title', scaleDenominator: 75000, citation: 'fixture-map-citation' }
const UNIT: GeologicUnit = {
  symbol: 'Fx',
  name: 'Fixture unit',
  description: 'fixture-unit-description',
  interpretation: 'fixture-unit-interpretation',
  map: MAP,
}
// The cited suited limit: only it carries an OFFICIAL mark with its citation.
const LIMIT: SlopeLimit = SUITED_SLOPE_LIMIT

const image = (id: string): SurfaceImage => ({
  id,
  rover: 'perseverance',
  sol: 321,
  camera: 'FIXTURE_CAM',
  takenUtcMs: unavailable('fixture'),
  takenLocalMeanSolarTime: unavailable('fixture'),
  rmc: unavailable('fixture'),
  thumbnailUrl: `https://example.invalid/${id}-thumb.jpg`,
  fullUrl: `https://example.invalid/${id}.jpg`,
  credit: 'fixture-credit',
  position: unavailable('fixture'),
})
const photo = (id: string, m: number, approximate = false): PhotoNearby => ({
  image: image(id),
  distanceM: derived(m, 'fixture-join'),
  approximate,
})

const render = ({
  unit = official(UNIT, MAP.citation),
  reason = derived('fixture-reason', 'fixture-goal-table'),
  elevation = official(-2540.4, 'fixture-dem'),
  slope = derived(3.2, 'fixture-slope'),
  fromPrevious = derived(1.24, 'fixture-distance'),
  legSlope = derived(5.1, 'fixture-leg-slope'),
  legHazards = derived([], 'fixture-scan'),
  photos = [],
  photosUnavailableReason,
  onClose,
}: {
  unit?: Classified<GeologicUnit>
  reason?: Classified<string> | null
  elevation?: Classified<number> | null
  slope?: Classified<number> | null
  fromPrevious?: Classified<number> | null
  legSlope?: Classified<number> | null
  legHazards?: Classified<Hazard[]> | null
  photos?: PhotoNearby[] | null
  photosUnavailableReason?: string
  onClose?: () => void
}) =>
  renderToStaticMarkup(
    <StopCard
      label="Stop 2"
      unit={unit}
      reason={reason}
      elevationM={elevation}
      slopeDeg={slope}
      slopeLimit={LIMIT}
      fromPreviousKm={fromPrevious}
      legSteepestSlopeDeg={legSlope}
      legHazards={legHazards}
      photos={photos}
      photosUnavailableReason={photosUnavailableReason}
      photoRadiusM={200}
      onClose={onClose}
    />,
  )

describe('StopCard', () => {
  it('names the stop and its unit, OFFICIAL with the map’s citation, and keeps the map’s description behind a toggle', () => {
    const html = render({})
    expect(html).toContain('Stop 2')
    expect(html).toContain('Fixture unit (Fx)')
    expect(html).toContain('OFFICIAL')
    expect(html).toContain('fixture-map-citation')
    expect(html).toMatch(/<details[^>]*><summary[^>]*>The map’s description<\/summary>/)
    expect(html).toContain('fixture-unit-description')
    expect(html).toContain('Interpretation: fixture-unit-interpretation')
  })

  it('shows a stop no map covers as unavailable, with the reason and no description', () => {
    const html = render({ unit: unavailable('fixture-outside-map') })
    expect(html).toContain('fixture-outside-map')
    expect(html).not.toContain('<details')
  })

  it('shows the science reason as the planner wrote it, with the goal table’s method', () => {
    const html = render({})
    expect(html).toContain('fixture-reason')
    expect(html).not.toContain('“fixture-reason”')
    expect(html).toContain('fixture-goal-table')
  })

  it('leaves the “Why stop here” row out for a route waypoint, which has no reason', () => {
    const html = render({ reason: null })
    expect(html).not.toContain('Why stop here')
    expect(html).toContain('Rock unit')
    expect(render({})).toContain('Why stop here')
  })

  it('adds no quotes of its own round a reason that already quotes the map (seen on real Jezero plans)', () => {
    // The shape `stopReason` writes: the unit's name, then the map's first sentence in quotes.
    const html = render({ reason: derived('fixture-unit: "fixture-quoted sentence."', 'fixture-goal-table') })
    expect(html).toContain('fixture-unit: &quot;fixture-quoted sentence.&quot;')
    expect(html).not.toMatch(/“|”/)
  })

  it('shows the ground: elevation, slope in the chart’s bands, distance from the previous stop', () => {
    const html = render({})
    expect(html).toContain('-2,540 m')
    expect(html).toContain('3.2° gentle')
    expect(html).toContain('From the previous stop')
    expect(html).toContain('1.2 km')
    expect(html).not.toContain('data-over-limit')
  })

  it('shows a height and slope still being read as unavailable, in the point menu’s words', () => {
    const html = render({ elevation: null, slope: null })
    expect(html).toContain(READING_ELEVATION_REASON)
    expect(html).toContain(READING_SLOPE_REASON)
    expect(html).not.toContain('-2,540 m')
    expect(html).not.toContain('data-over-limit')
  })

  it('says "First stop" instead of a distance at the first stop', () => {
    const html = render({ fromPrevious: null })
    expect(html).toContain('First stop')
    expect(html).not.toContain('From the previous stop')
  })

  it('flags a slope over the limit with the HUD’s rule and words', () => {
    const html = render({ slope: derived(23.4, 'fixture-slope') })
    expect(html).toContain('23.4° steep')
    expect(html).toContain('data-over-limit')
    expect(html).toContain(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`)
    expect(html).toContain('NASA EVA-EXP-0075')
    expect(render({ slope: derived(20, 'fixture-slope') })).not.toContain('data-over-limit')
  })

  it('puts the stop’s slope flag straight after the slope, before the distance', () => {
    // At the card's width the distance wraps; a flag under it read as the distance's flag.
    const html = render({ slope: derived(23.4, 'fixture-slope'), legHazards: null, legSlope: null })
    const flag = html.indexOf('data-over-limit')
    expect(html.indexOf('23.4° steep')).toBeLessThan(flag)
    expect(flag).toBeLessThan(html.indexOf('From the previous stop'))
  })

  it('shows an unknown slope as unavailable with its reason, never flagged', () => {
    const html = render({ slope: unavailable('fixture-dem-gap') })
    expect(html).toContain('fixture-dem-gap')
    expect(html).not.toContain('data-over-limit')
  })

  it('with no photos near, says how far it looked', () => {
    expect(render({})).toContain('No rover photos within 200 m')
  })

  it('says photos never read are unavailable with the reason, never that none were found', () => {
    const html = render({ photos: null })
    expect(html).toContain('unavailable')
    expect(html).toContain('The rover photos have not been read, so nothing was searched')
    expect(html).not.toContain('No rover photos')
  })

  it('says photos read but not placeable are unavailable for that reason, never that none were found', () => {
    const html = render({ photos: null, photosUnavailableReason: PHOTOS_NOT_PLACED_REASON })
    // Static markup escapes the apostrophe in "rover's", so match the words after it.
    expect(html).toContain(PHOTOS_NOT_PLACED_REASON.split("'s ")[1])
    expect(html).not.toContain('have not been read, so nothing was searched')
    expect(html).not.toContain('No rover photos')
  })

  it('shows a height or distance that is not a finite figure as unavailable, never NaN or a negative distance', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const html = render({ elevation: official(bad, 'fixture-dem'), fromPrevious: derived(bad, 'fixture-distance') })
      expect(html).toContain('The elevation is not a finite number')
      expect(html).toContain('The distance is not a finite, unsigned number')
      expect(html).not.toMatch(/NaN|Infinity|∞/)
    }
    const negative = render({ fromPrevious: derived(-1, 'fixture-distance') })
    expect(negative).toContain('The distance is not a finite, unsigned number')
    expect(negative).not.toContain('-1000 m')
    // Below the areoid is a real height, not a bad one.
    expect(render({})).toContain('-2,540 m')
  })

  it('shows the nearest photos as lazy thumbnails linking to full size, each with sol, camera, distance and credit', () => {
    const html = render({ photos: [photo('b', 120), photo('a', 40, true)] })
    // Nearest first.
    expect(html.indexOf('a-thumb.jpg')).toBeLessThan(html.indexOf('b-thumb.jpg'))
    expect(html).toMatch(/<img[^>]*src="https:\/\/example.invalid\/a-thumb.jpg"[^>]*loading="lazy"/)
    expect(html).toMatch(/<a[^>]*href="https:\/\/example.invalid\/a.jpg"[^>]*target="_blank"[^>]*rel="noreferrer"/)
    expect(html).toContain('aria-label="Perseverance FIXTURE_CAM, sol 321: open full size in a new tab"')
    expect(html).toContain('>Sol 321<')
    expect(html).toContain('title="FIXTURE_CAM">FIXTURE_CAM<')
    expect(html).toContain('40 m away')
    expect(html).toContain('fixture-join')
    expect(html.match(/Credit: fixture-credit/g)).toHaveLength(2)
    // Only the approximate one says so.
    expect(html.match(/Approximate position/g)).toHaveLength(1)
    expect(html).not.toContain('No rover photos')
  })

  it('marks the photos OFFICIAL only when it shows some: not above "unavailable" or "none found"', () => {
    // The photo section's badge text; the rock unit has an OFFICIAL badge of its own.
    const photosMark = 'raw images as published'
    expect(render({ photos: null })).not.toContain(photosMark)
    expect(render({ photos: [] })).not.toContain(photosMark)
    expect(render({ photos: [photo('a', 40)] })).toContain(photosMark)
  })

  it('counts the photos it does not show', () => {
    const html = render({ photos: Array.from({ length: 6 }, (_, i) => photo(`p${i}`, i * 20)) })
    expect(html.match(/<img /g)).toHaveLength(3)
    expect(html).toContain('3 more within 200 m')
  })

  it('is a closable window only when the host passes onClose', () => {
    expect(render({})).not.toContain('aria-label="Close Stop 2"')
    expect(render({ onClose: () => {} })).toContain('aria-label="Close Stop 2"')
    expect(render({})).toContain('aria-label="Minimise Stop 2"')
  })
})

describe('StopCard radiation warning', () => {
  const AT = { latitude: 18.43, longitudeEast: 77.45 }
  const RADIATION: Hazard = {
    id: 'fixture-radiation',
    kind: 'radiation',
    coordinate: AT,
    magnitude: derived(0.68, 'fixture-shielding'),
    unit: RADIATION_HAZARD_UNIT,
  }
  const SLOPE: Hazard = { id: 'fixture-slope', kind: 'slope', coordinate: AT, magnitude: derived(24, 'fixture-slope'), unit: 'deg' }

  it('shows a radiation hazard on the leg into the stop: the rule’s words, the highest point and the atmosphere overhead', () => {
    const html = render({ legHazards: derived([SLOPE, RADIATION], 'fixture-scan') })
    expect(html).toContain('On the way here')
    expect(html.match(/data-radiation-warning/g)).toHaveLength(1)
    expect(html).toContain(SHIELDING_WARNING_TEXT)
    expect(html).toContain('Highest point ')
    expect(html).toContain('0.68 of Gale&#x27;s')
    expect(html).toContain('fixture-shielding')
    // The shielding rule: about shielding, never a dose.
    expect(html).not.toMatch(/higher dose|mSv/i)
  })

  it('shows no radiation warning with no radiation hazard or an unscanned leg', () => {
    const cases: Classified<Hazard[]>[] = [derived([SLOPE], 'fixture-scan'), derived([], 'fixture-scan'), unavailable('fixture-not-scanned')]
    for (const legHazards of cases) expect(render({ legHazards })).not.toContain('data-radiation-warning')
  })

  it('says ground with no shielding figure was not checked, with the reason: no warning, no fraction', () => {
    const notChecked: Hazard = { ...RADIATION, id: 'fixture-radiation-unchecked', magnitude: unavailable('fixture-no-heights') }
    const html = render({ legHazards: derived([notChecked], 'fixture-scan') })
    expect(html).toContain('On the way here')
    expect(html).toContain('Radiation not checked')
    expect(html).toContain('fixture-no-heights')
    expect(html).not.toContain('data-radiation-warning')
    expect(html).not.toContain(SHIELDING_WARNING_TEXT)
    expect(html).not.toMatch(/of Gale/)
  })
})

describe('StopCard leg into the stop', () => {
  const AT = { latitude: 18.43, longitudeEast: 77.45 }
  const obstacle = (unit: string, magnitude: Classified<number>): Hazard => ({
    id: `fixture-obstacle-${unit}`,
    kind: 'mapped-obstacle',
    coordinate: AT,
    magnitude,
    unit,
  })
  const SLOPE: Hazard = { id: 'fixture-slope', kind: 'slope', coordinate: AT, magnitude: derived(24, 'fixture-slope'), unit: 'deg' }

  it('shows the leg’s steepest slope in the chart’s bands, with the planner’s method', () => {
    const html = render({})
    expect(html).toContain('On the way here')
    expect(html).toContain('Steepest slope')
    expect(html).toContain('fixture-leg-slope')
    expect(html).not.toContain('data-over-limit')
  })

  it('flags a leg over the limit with the HUD’s rule and words, apart from the slope at the stop', () => {
    const html = render({ legSlope: derived(23.3, 'fixture-leg-slope') })
    expect(html).toContain('23.3° steep')
    expect(html.match(/data-over-limit/g)).toHaveLength(1)
    expect(html).toContain(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`)
    expect(render({ legSlope: derived(20, 'fixture-leg-slope') })).not.toContain('data-over-limit')
  })

  it('shows a leg slope never measured as unavailable with its reason, never flagged', () => {
    const html = render({ legSlope: unavailable('fixture-leg-no-heights') })
    expect(html).toContain('fixture-leg-no-heights')
    expect(html).not.toContain('data-over-limit')
  })

  it('flags a leg part over the limit and part not checked, as the HUD does, its slope still unavailable', () => {
    const html = render({ legSlope: unavailable('fixture-leg-part-not-checked'), legHazards: derived([SLOPE], 'fixture-scan') })
    expect(html).toContain('fixture-leg-part-not-checked')
    expect(html.match(/data-over-limit/g)).toHaveLength(1)
    expect(html).toContain(`Over the 20° limit: ${SUITED_SLOPE_LIMIT.label}`)
  })

  it('does not flag a part-checked leg whose stretch has no figure', () => {
    const unchecked: Hazard = { ...SLOPE, magnitude: unavailable('fixture-stretch-not-checked') }
    const html = render({ legSlope: unavailable('fixture-leg-part-not-checked'), legHazards: derived([unchecked], 'fixture-scan') })
    expect(html).not.toContain('data-over-limit')
  })

  it('names a mapped obstacle as the walk panel does, with the map’s mark', () => {
    const html = render({ legHazards: derived([obstacle('fixture-scarp', unavailable('fixture-no-size'))], 'fixture-scan') })
    expect(html).toContain('On the map: fixture-scarp')
    expect(html).toContain('fixture-no-size')
  })

  it('says mapped obstacles were not checked when the map was not read, so the leg never reads as clear', () => {
    const html = render({ legHazards: derived([obstacle(HAZARD_NOT_CHECKED, unavailable('fixture-map-down'))], 'fixture-scan') })
    expect(html).toContain('Mapped obstacles not checked')
    expect(html).toContain('fixture-map-down')
  })

  it('says "None flagged" with the scan’s mark for a leg with no flags, as the walk panel does', () => {
    const html = render({})
    expect(html).toContain('None flagged')
    expect(html).toContain('fixture-scan')
    expect(html).not.toContain('No other flags')
  })

  it('says "No other flags" when the only flag is the slope, already shown under the slope row', () => {
    const html = render({ legSlope: derived(24, 'fixture-leg-slope'), legHazards: derived([SLOPE], 'fixture-scan') })
    expect(html).toContain('No other flags')
    expect(html).not.toContain('None flagged')
  })

  it('says "Slope not checked" with its reason, and neither label, when the only flag is a stretch never checked', () => {
    const unchecked: Hazard = { ...SLOPE, id: 'fixture-unchecked', magnitude: unavailable('fixture-stretch-not-checked') }
    const html = render({ legSlope: unavailable('fixture-leg-too-short'), legHazards: derived([unchecked], 'fixture-scan') })
    expect(html).toContain('Slope not checked')
    expect(html).toContain('fixture-stretch-not-checked')
    expect(html).not.toContain('No other flags')
    expect(html).not.toContain('None flagged')
  })

  it('keeps a measured slope flag under the slope row but still shows a stretch never checked', () => {
    const unchecked: Hazard = { ...SLOPE, id: 'fixture-unchecked', magnitude: unavailable('fixture-stretch-not-checked') }
    const html = render({ legSlope: unavailable('fixture-leg-part-not-checked'), legHazards: derived([SLOPE, unchecked], 'fixture-scan') })
    expect(html).toContain('Slope not checked')
    expect(html).toContain('fixture-stretch-not-checked')
    expect(html).not.toContain('Steep slope')
    expect(html).not.toContain('No other flags')
    expect(html).not.toContain('None flagged')
  })

  it('shows a leg the planner could not scan as unavailable flags, with the reason', () => {
    const html = render({ legHazards: unavailable('fixture-not-scanned') })
    expect(html).toContain('Flags')
    expect(html).toContain('fixture-not-scanned')
  })

  it('does not repeat a slope flag under the slope row', () => {
    const html = render({ legSlope: derived(24, 'fixture-leg-slope'), legHazards: derived([SLOPE], 'fixture-scan') })
    expect(html).not.toContain('Steep slope')
    expect(html.match(/data-over-limit/g)).toHaveLength(1)
  })

  it('leaves the section out at the first stop, where no leg leads in', () => {
    const html = render({ fromPrevious: null, legSlope: null, legHazards: null })
    expect(html).not.toContain('On the way here')
    expect(html).not.toContain('Steepest slope')
  })
})

describe('StopCard with the photo join', () => {
  // About 59.3 km per degree of latitude on Mars: offsets of 50 m, 120 m and 5 km north of the stop.
  const STOP = { latitude: 18.4, longitudeEast: 77.4 }
  const north = (m: number) => ({ latitude: STOP.latitude + m / 59_274, longitudeEast: STOP.longitudeEast })
  const placed = (id: string, position: Classified<{ latitude: number; longitudeEast: number }>): SurfaceImage => ({
    ...image(id),
    position,
  })

  it("takes photosNear's output as it is: nearest first, the approximate one marked, far and unplaced ones left out", () => {
    const images = [
      placed('far', derived(north(5000), 'fixture-join')),
      placed('approx', derived(north(120), `${APPROXIMATE_POSITION}: fixture-earlier-waypoint`)),
      placed('unplaced', unavailable('fixture-no-site-drive')),
      placed('exact', derived(north(50), 'fixture-join')),
    ]
    const html = render({ photos: photosNear(images, STOP, 200) })
    expect(html.indexOf('exact.jpg')).toBeGreaterThan(-1)
    expect(html.indexOf('exact.jpg')).toBeLessThan(html.indexOf('approx.jpg'))
    // One visible label, on the approximate photo; the join's method also names it inside the distance's mark.
    expect(html.match(/<span class="italic text-ink-muted">Approximate position<\/span>/g)).toHaveLength(1)
    expect(html).toContain('Approximate position: fixture-earlier-waypoint')
    expect(html).not.toContain('far.jpg')
    expect(html).not.toContain('unplaced.jpg')
  })

  it('says none were found within the radius when the join places none near the stop', () => {
    const html = render({ photos: photosNear([placed('far', derived(north(5000), 'fixture-join'))], STOP, 200) })
    expect(html).toContain('No rover photos within 200 m')
  })
})
