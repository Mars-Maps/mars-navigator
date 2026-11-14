import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, simulated, unavailable, type Classified } from '../../src/domain'
import type {
  ElevationProfile,
  ElevationProfileSample,
} from '../../src/features/route-analysis/elevationProfile'
import {
  ElevationProfileView,
  NO_SAMPLE_ELEVATION_REASON,
  ProfileHeaderMarks,
  SampleReadout,
} from '../../src/features/mission-ui/navigation/ElevationProfilePanel'

// Test fixtures only — invented elevations, not data.
const METHOD = 'fixture-method'
const at = (km: number, m: number | null): ElevationProfileSample => ({
  coordinate: { latitude: 0, longitudeEast: km },
  distanceKm: km,
  elevationMeters: m === null ? unavailable('no data') : derived(m, METHOD),
})
const profileOf = (...samples: ElevationProfileSample[]): ElevationProfile => ({
  samples,
  totalDistanceKm: samples[samples.length - 1].distanceKm,
})

const render = (profile: Classified<ElevationProfile> | null) =>
  renderToStaticMarkup(<ElevationProfileView profile={profile} />)

const count = (html: string, needle: string) => html.split(needle).length - 1

// The chart's own SVG; the title bar's Minimise icon is an <svg> too.
const CHART_SVG = 'preserveAspectRatio="none"'

describe('ElevationProfileView', () => {
  it('says no route is planned when there is no profile', () => {
    const html = render(null)
    expect(html).toContain('No route planned')
    expect(html).not.toContain(CHART_SVG)
  })

  it('shows UNAVAILABLE with its reason instead of empty axes', () => {
    const html = render(unavailable('fixture-reason'))
    expect(html).toContain('Elevation unavailable')
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain('fixture-reason')
    expect(html).not.toContain(CHART_SVG)
  })

  it('shows the DERIVED badge and method above the chart', () => {
    const html = render(derived(profileOf(at(0, 100), at(2, 300)), METHOD))
    expect(html).toContain('DERIVED')
    expect(html).toContain(METHOD)
    expect(html).toContain(CHART_SVG)
    expect(count(html, '<polyline')).toBe(1)
    expect(html).toContain('100 m')
    expect(html).toContain('300 m')
    expect(html).toContain('2.0 km')
    expect(html).not.toContain('Gaps')
  })

  it('lets the chart shrink to its panel: an SVG with a height and a viewBox has an intrinsic width', () => {
    const html = render(derived(profileOf(at(0, 100), at(2, 300)), METHOD))
    const svg = html.match(/<svg[^>]*preserveAspectRatio="none"[^>]*>/)?.[0] ?? ''
    expect(svg).toMatch(/class="[^"]*\bmin-w-0\b/)
  })

  it('colours each stretch by its slope band and names the bands in a legend', () => {
    // 1 km stretches: 10 m (gentle), 150 m (moderate), 400 m (steep), then a gap.
    const html = render(
      derived(profileOf(at(0, 0), at(1, 10), at(2, 160), at(3, 560), at(4, null), at(5, 600), at(6, 605)), METHOD),
    )
    const strokes = [...html.matchAll(/<polyline[^>]*class="([^"]+)"/g)].map((m) => m[1])
    expect(strokes).toEqual(['stroke-slope-gentle', 'stroke-slope-moderate', 'stroke-slope-steep', 'stroke-slope-gentle'])
    expect(html).toContain('bg-slope-gentle')
    expect(html).toContain('bg-slope-moderate')
    expect(html).toContain('bg-slope-steep')
    expect(html).toContain('gentle under 5°')
    expect(html).toContain('steep 15° and over')
    expect(html).toContain('Not an official limit')
  })

  it('keeps the extremes inside the frame and draws a 2 px line', () => {
    const html = render(derived(profileOf(at(0, 100), at(2, 300)), METHOD))
    const points = html.match(/<polyline[^>]*points="([^"]+)"/)?.[1] ?? ''
    const ys = points.split(' ').map((pair) => Number(pair.split(',')[1]))
    // The viewBox is 120 tall: the high end sits below the top, the low end above the bottom.
    expect(Math.min(...ys)).toBeGreaterThan(0)
    expect(Math.max(...ys)).toBeLessThan(120)
    expect(Math.min(...ys)).toBeCloseTo(120 * 0.08 / 1.16, 3)
    expect(html).toMatch(/<polyline[^>]*stroke-width="2"/)
  })

  it('shows the source, not a method, for a SIMULATED profile, and marks its slopes SIMULATED too', () => {
    const html = render(simulated(profileOf(at(0, 1), at(1, 2)), 'fixture-source'))
    expect(html).toContain('SIMULATED')
    expect(html).toContain('fixture-source')
    // The legend's mark follows the profile: no DERIVED mark anywhere on a simulated chart.
    expect(html).not.toContain('>DERIVED<')
    expect(count(html, '>SIMULATED<')).toBe(2)
  })

  it('breaks the line at a gap and says so', () => {
    const html = render(
      derived(profileOf(at(0, 10), at(1, 20), at(2, null), at(3, 40), at(4, 50)), METHOD),
    )
    expect(count(html, '<polyline')).toBe(2)
    expect(html).toContain('Gaps: no elevation data')
  })

  it('draws an isolated sample as a dot, not a line', () => {
    const html = render(derived(profileOf(at(0, 10), at(1, null), at(2, 30), at(3, 40)), METHOD))
    expect(count(html, '<polyline')).toBe(1)
    expect(html).toContain('h 0')
  })

  it('shows the unavailable frame and mark when no sample has elevation', () => {
    const html = render(derived(profileOf(at(0, null), at(1, null)), METHOD))
    expect(html).toContain('Elevation unavailable')
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain(NO_SAMPLE_ELEVATION_REASON)
    expect(html).toContain('h-24')
    expect(html).toContain('border-dashed')
    expect(html).not.toContain(CHART_SVG)
    expect(html).not.toContain('0 m')
  })

  it('labels a flat profile with its real value, not the padded scale', () => {
    const html = render(derived(profileOf(at(0, 500), at(0.5, 500)), METHOD))
    expect(html).toContain('Elevation 500 m throughout 500 m')
    expect(html).not.toContain('499 m')
    expect(html).not.toContain('501 m')
  })
})

// The panel always opens expanded, so the folded bar is tested through its marks.
describe('ProfileHeaderMarks: the folded bar keeps the UNAVAILABLE mark', () => {
  const marks = (profile: Classified<ElevationProfile> | null, minimized: boolean) =>
    renderToStaticMarkup(<ProfileHeaderMarks profile={profile} minimized={minimized} />)
  const allGaps = derived(profileOf(at(0, null), at(1, null)), METHOD)

  it('folded, all samples gaps: the DERIVED mark and the UNAVAILABLE mark with the reason', () => {
    const html = marks(allGaps, true)
    expect(html).toContain('DERIVED')
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain(NO_SAMPLE_ELEVATION_REASON)
  })

  it('folded, one sample with elevation: only the profile mark', () => {
    const html = marks(derived(profileOf(at(0, null), at(1, 20)), METHOD), true)
    expect(html).toContain('DERIVED')
    expect(html).not.toContain('UNAVAILABLE')
  })

  it('folded, UNAVAILABLE as a whole: the mark with the profile reason', () => {
    const html = marks(unavailable('fixture-reason'), true)
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain('fixture-reason')
  })

  it('open: no UNAVAILABLE mark in the bar, as the body carries it', () => {
    expect(marks(allGaps, false)).not.toContain('UNAVAILABLE')
    expect(marks(unavailable('fixture-reason'), false)).toBe('')
  })

  it('no profile: no mark', () => {
    expect(marks(null, true)).toBe('')
  })
})

describe('ElevationProfileView unavailable frame', () => {
  it('keeps the chart height with a hatched box, with no axis or value', () => {
    const html = render(unavailable('fixture-reason'))
    expect(html).toContain('h-24')
    expect(html).toContain('border-dashed')
    expect(html).not.toContain(CHART_SVG)
    expect(html).not.toContain('0 m')
    expect(html).not.toContain('0 km')
  })
})

describe('ElevationProfileView hover', () => {
  it('makes the chart focusable and says the arrow keys read it', () => {
    const html = render(derived(profileOf(at(0, 100), at(2, 300)), METHOD))
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('Arrow keys read each sample')
  })

  it('shows no readout or guide before the pointer arrives', () => {
    const html = render(derived(profileOf(at(0, 100), at(2, 300)), METHOD))
    expect(html).not.toContain('<line')
    expect(html).toContain('role="status"')
  })
})

describe('SampleReadout', () => {
  const readout = (sample: ElevationProfileSample) =>
    renderToStaticMarkup(<SampleReadout sample={sample} />)

  it('reads out the distance, elevation and classification', () => {
    const html = readout(at(12.34, -2140))
    expect(html).toContain('12.3 km')
    expect(html).toContain('-2,140 m')
    expect(html).toContain('DERIVED')
  })

  it('reads a gap sample as unavailable, never as a number', () => {
    const html = readout(at(3, null))
    expect(html).toContain('3.0 km')
    expect(html).toContain('Elevation unavailable')
    expect(html).toContain('UNAVAILABLE')
    expect(html).toContain('title="no data"')
    expect(html).not.toMatch(/\d m</)
  })

  it('adds the slope of the stretch that ends at the sample, in words as well as degrees', () => {
    const html = renderToStaticMarkup(<SampleReadout sample={at(2, 300)} previous={at(0, 100)} />)
    expect(html).toContain('5.7° moderate')
    expect(html).toContain('Not an official limit')
    expect(count(html, '>DERIVED<')).toBe(2)
    // A slope from a simulated height is simulated.
    const sim = (km: number, m: number): ElevationProfileSample => ({ ...at(km, m), elevationMeters: simulated(m, 'fixture') })
    const mixed = renderToStaticMarkup(<SampleReadout sample={at(2, 300)} previous={sim(0, 100)} />)
    expect(mixed).toContain('5.7° moderate')
    expect(count(mixed, '>SIMULATED<')).toBe(1)
    // No slope without a previous height, or at the first sample.
    expect(renderToStaticMarkup(<SampleReadout sample={at(2, 300)} previous={at(0, null)} />)).not.toContain('°')
    expect(renderToStaticMarkup(<SampleReadout sample={at(2, 300)} />)).not.toContain('°')
  })

  it('gives the distance in km even under 1 km, so it never reads as an elevation', () => {
    const html = readout(at(0.25, 10))
    expect(html).toContain('0.25 km')
    expect(html).not.toContain('250 m')
    expect(readout(at(0, 10))).toContain('0.00 km')
  })
})
