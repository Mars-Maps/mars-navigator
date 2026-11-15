import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SHIELDING_METHOD, SHIELDING_WARNING_TEXT, derived, type MarsCoordinate, type RouteOption, type RouteRequest } from '../../src/domain'
import { planRouteOptions } from '../../src/app/planRoute'
import { minimizesForNavigation } from '../../src/features/mars-3d/captionAlerts'
import { HazardsPanel } from '../../src/features/mission-ui/navigation/HazardsPanel'
import { ProgressTracker } from '../../src/features/mission-ui/navigation/ProgressTracker'
import { planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { pendingOption } from '../../src/features/route-analysis/strategies/searchedRoute'
import { methodologyText, visibleText } from './methodology.helpers'
import { at, fixtureTerrain } from './terrain.helpers'

// Test fixtures only: invented coordinates and hazards.
const A: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const D: MarsCoordinate = { latitude: 10, longitudeEast: 10 }
const REQUEST: RouteRequest = { departure: A, stops: [], destination: D }
const route = planRouteOptions(REQUEST).find((o) => o.strategy === 'shortest')!

const withHazards = (hazards: RouteOption['hazards']): RouteOption => ({ ...route, hazards })
// What follows the h2 on its line, up to the end of the heading row.
const heading = (html: string) => html.match(/<h2[^>]*>Hazards<\/h2>(.*?)<\/div>/)![1]
const visible = visibleText
const hidden = methodologyText
// As `detectHazards` words a scan: the kinds it ran, each with its method.
const SCAN = 'Scanned for slope: fixture slope scan; radiation: fixture radiation scan'

describe('HazardsPanel in the navigation column', () => {
  it('puts a one-line state on the heading line', () => {
    expect(heading(renderToStaticMarkup(<HazardsPanel route={null} />))).toContain(
      'No route planned',
    )
    // The planner leaves hazards UNAVAILABLE until a scan exists.
    expect(route.hazards.classification).toBe('UNAVAILABLE')
    expect(heading(renderToStaticMarkup(<HazardsPanel route={route} />))).toContain(
      'Not yet scanned',
    )
    const none = withHazards(derived([], SCAN))
    expect(heading(renderToStaticMarkup(<HazardsPanel route={none} />))).toContain(
      'Steep slope and radiation: none found',
    )
  })

  it('separates every one-line state from the heading', () => {
    const SEPARATOR = /<span aria-hidden="true"[^>]*>·<\/span>/
    expect(heading(renderToStaticMarkup(<HazardsPanel route={null} />))).toMatch(SEPARATOR)
    expect(heading(renderToStaticMarkup(<HazardsPanel route={route} />))).toMatch(SEPARATOR)
    expect(heading(renderToStaticMarkup(<HazardsPanel route={withHazards(derived([], SCAN))} />))).toMatch(SEPARATOR)
  })

  it('keeps the long words out of the panel, behind one Methodology button', () => {
    expect(renderToStaticMarkup(<HazardsPanel route={null} />)).not.toContain('data-methodology')
    const none = renderToStaticMarkup(<HazardsPanel route={withHazards(derived([], SCAN))} />)
    expect(none.match(/<button[^>]*data-methodology=""/g)).toHaveLength(1)
    // What is shown without a click: the heading, the one-line state and the button's word.
    expect(visible(none)).toBe('Hazardsi·Steep slope and radiation: none foundMethodology')
    // Closed, the explanation is in the markup but hidden.
    expect(hidden(none)).toContain('How the hazards were scanned')
    expect(hidden(none)).toContain('Not scanned for')
    expect(hidden(none)).toContain('Sudden drop, dust, temperature and mapped obstacle')
    expect(hidden(none)).toContain('EVA-EXP-0075')
    expect(hidden(none)).toContain(SHIELDING_WARNING_TEXT)
  })

  it('says why in the methodology when the route is not yet scanned', () => {
    const html = renderToStaticMarkup(<HazardsPanel route={route} />)
    if (route.hazards.classification !== 'UNAVAILABLE') throw new Error('expected an unscanned route')
    expect(hidden(html)).toContain(route.hazards.reason)
    expect(hidden(html)).not.toContain('how it is measured')
  })

  it('lists found hazards below the heading, with no one-line state', () => {
    const slope = (id: string, deg: number) => ({
      id,
      kind: 'slope' as const,
      coordinate: A,
      magnitude: derived(deg, 'fixture slope'),
      unit: '°',
    })
    const html = renderToStaticMarkup(<HazardsPanel route={withHazards(derived([slope('h1', 17.25), slope('h2', 23)], 'fixture scan'))} />)
    expect(html).toContain('<ul')
    expect(html.match(/Steep slope<\/span>/g)).toHaveLength(2)
    expect(visible(html)).toContain('17.3°')
    // Only the stretch over the cited limit says so.
    expect(html.match(/data-over-limit=""/g)).toHaveLength(1)
    expect(visible(html)).toContain('over 20°')
    expect(heading(html)).toContain('· 2')
    expect(visible(html)).not.toContain('none found')
    expect(html).not.toContain('Not yet scanned')
  })
})

describe('HazardsPanel: what the route search kept off the path', () => {
  const signal = new AbortController().signal
  const request = { departure: at(0, 0), stops: [], destination: at(1, 0) }
  const scanned = (option: RouteOption, hazards: RouteOption['hazards'] = derived([], SCAN)) => ({
    ...option,
    hazards,
  })

  it('says in the methodology what a searched route kept off its path, as what the search did, not a scan', async () => {
    const searched = scanned(await planFastest(request, fixtureTerrain(() => 0), signal))
    const html = renderToStaticMarkup(<HazardsPanel route={searched} />)
    expect(visible(html)).not.toContain('kept off')
    const more = hidden(html)
    expect(more).toContain('Kept off by the route search')
    // The search's own words, the ones its path method is built from.
    expect(more).toContain('Steps over 20° (')
    expect(more).toContain('small craters and ridged ground are not avoided.')
    expect(more).toContain('not a scan of the path')
  })

  it('does not say mapped lines were kept off where the map was not read', async () => {
    const option = await planFastest(request, fixtureTerrain(() => 0, { mapFails: 'fixture map down' }), signal)
    const more = hidden(renderToStaticMarkup(<HazardsPanel route={scanned(option)} />))
    expect(more).toContain('Steps over 20° (')
    expect(more).not.toContain('Steps crossing a line')
  })

  it('says nothing was kept off for a route that was not searched', () => {
    for (const option of [route, pendingOption('fastest', REQUEST)]) {
      const html = renderToStaticMarkup(<HazardsPanel route={scanned(option)} />)
      expect(hidden(html)).toContain('Sudden drop, dust, temperature and mapped obstacle')
      expect(html).not.toContain('Kept off')
    }
  })
})

describe('ProgressTracker in the navigation column', () => {
  it('shows travelled and remaining as unavailable, without repeating From and To', () => {
    const html = renderToStaticMarkup(<ProgressTracker route={route} />)
    expect(html).toContain('Travelled')
    expect(html).toContain('Remaining')
    // The value text itself, not class names that contain the word.
    expect(html.match(/>unavailable</g)).toHaveLength(2)
    // The read-only route line at the top of the column shows the ends.
    expect(html).not.toContain('From')
    expect(html).not.toContain('>To<')
  })

  it('says no route is planned without one', () => {
    expect(renderToStaticMarkup(<ProgressTracker route={null} />)).toContain('No route planned')
  })
})

describe('minimizesForNavigation: the caption on entering navigation', () => {
  it('minimizes for notes: the route line and a layer caveat', () => {
    expect(minimizesForNavigation([])).toBe(true)
    expect(minimizesForNavigation(['route-line', 'caveat:satellite'])).toBe(true)
  })

  it('stays open for an error nothing else on screen shows', () => {
    expect(minimizesForNavigation(['route-line', 'layer-unavailable:thermal'])).toBe(false)
    expect(minimizesForNavigation(['base-unavailable:geology'])).toBe(false)
    expect(minimizesForNavigation(['sun-unavailable'])).toBe(false)
  })
})

describe('HazardsPanel says what this scan did (review of the hazards panel)', () => {
  const noSlope = withHazards(
    derived([], 'Scanned for radiation: fixture radiation scan. Not scanned: slope (fixture: no heights for the slope); dust (dust detection not implemented)'),
  )

  it('carries the scan as DERIVED, with its own method in the mark', () => {
    const html = renderToStaticMarkup(<HazardsPanel route={withHazards(derived([], SCAN))} />)
    expect(heading(html)).toContain('DERIVED')
    expect(html).toContain('fixture slope scan')
  })

  it('gives a reason that holds "; " and brackets whole, not cut at the first of them', () => {
    const reason = 'no two points have a height (the straight line carries none; a searched path does)'
    const route = withHazards(
      derived([], `Scanned for radiation: fixture radiation scan. Not scanned: slope (${reason}); dust (dust detection not implemented)`),
    )
    expect(hidden(renderToStaticMarkup(<HazardsPanel route={route} />))).toContain(reason)
  })

  it('never says "none found" of a kind this scan could not run', () => {
    const html = renderToStaticMarkup(<HazardsPanel route={noSlope} />)
    expect(visible(html)).toContain('Radiation: none found')
    expect(visible(html)).not.toContain('Steep slope')
    expect(hidden(html)).toContain('Steep slope: not scanned on this route')
    expect(hidden(html)).toContain('fixture: no heights for the slope')
    expect(hidden(html)).not.toContain('Steep slope: how it is measured')
  })

  it('keeps the shielding calculation and its caveat within reach when nothing was found', () => {
    const html = renderToStaticMarkup(<HazardsPanel route={withHazards(derived([], SCAN))} />)
    expect(hidden(html)).toContain(SHIELDING_METHOD)
  })

  it('marks a steep stretch in the steep colour and only one over the cited limit in red', () => {
    const slope = (id: string, deg: number) => ({ id, kind: 'slope' as const, coordinate: A, magnitude: derived(deg, 'fixture slope'), unit: '°' })
    const html = renderToStaticMarkup(<HazardsPanel route={withHazards(derived([slope('h1', 17), slope('h2', 23)], SCAN))} />)
    const glyphs = html.match(/<svg[^>]*class="size-4 shrink-0 text-[a-z-]+"/g) ?? []
    expect(glyphs.map((g) => g.match(/text-[a-z-]+/)![0])).toEqual(['text-slope-steep', 'text-danger'])
  })
})
