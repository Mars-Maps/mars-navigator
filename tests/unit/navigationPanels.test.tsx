import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { derived, type MarsCoordinate, type RouteOption, type RouteRequest } from '../../src/domain'
import { planRouteOptions } from '../../src/app/planRoute'
import { minimizesForNavigation } from '../../src/features/mars-3d/captionAlerts'
import { HazardsPanel } from '../../src/features/mission-ui/navigation/HazardsPanel'
import { ProgressTracker } from '../../src/features/mission-ui/navigation/ProgressTracker'
import { planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { pendingOption } from '../../src/features/route-analysis/strategies/searchedRoute'
import { at, fixtureTerrain } from './terrain.helpers'

// Test fixtures only: invented coordinates and hazards.
const A: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const D: MarsCoordinate = { latitude: 10, longitudeEast: 10 }
const REQUEST: RouteRequest = { departure: A, stops: [], destination: D }
const route = planRouteOptions(REQUEST).find((o) => o.strategy === 'shortest')!

const withHazards = (hazards: RouteOption['hazards']): RouteOption => ({ ...route, hazards })
// What follows the h2 on its line, up to the end of the heading row.
const heading = (html: string) => html.match(/<h2[^>]*>Hazards<\/h2>(.*?)<\/div>/)![1]

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
    const none = withHazards(derived([], 'fixture scan'))
    expect(heading(renderToStaticMarkup(<HazardsPanel route={none} />))).toContain(
      'Scanned for radiation: none found',
    )
    expect(renderToStaticMarkup(<HazardsPanel route={none} />)).toContain(
      'not scanned for steep slope, sudden drop, dust, temperature and mapped obstacle',
    )
  })

  it('separates only a state that shares the heading line', () => {
    const SEPARATOR = /<span aria-hidden="true"[^>]*>·<\/span>/
    expect(heading(renderToStaticMarkup(<HazardsPanel route={null} />))).toMatch(SEPARATOR)
    expect(heading(renderToStaticMarkup(<HazardsPanel route={route} />))).toMatch(SEPARATOR)
    // Scanned and none found is a sentence on its own line: no dangling "·"
    // after the heading, and the line is full width so it never shares it.
    const none = renderToStaticMarkup(<HazardsPanel route={withHazards(derived([], 'fixture scan'))} />)
    expect(heading(none)).not.toMatch(SEPARATOR)
    expect(none).toMatch(/<p class="basis-full[^"]*">Scanned for radiation: none found/)
  })

  it('lists found hazards below the heading, with no one-line state', () => {
    const found = withHazards(
      derived(
        [
          {
            id: 'h1',
            kind: 'slope',
            coordinate: A,
            magnitude: derived(12, 'fixture slope'),
            unit: 'deg',
          },
        ],
        'fixture scan',
      ),
    )
    const html = renderToStaticMarkup(<HazardsPanel route={found} />)
    expect(html).toContain('<ul')
    expect(html).toContain('Steep slope')
    expect(html).not.toContain('none found')
    expect(html).not.toContain('Not yet scanned')
  })
})

describe('HazardsPanel: what the route search kept off the path', () => {
  const signal = new AbortController().signal
  const request = { departure: at(0, 0), stops: [], destination: at(1, 0) }
  const scanned = (option: RouteOption, hazards: RouteOption['hazards'] = derived([], 'fixture scan')) => ({
    ...option,
    hazards,
  })
  const KEPT_BOTH = 'steep slope and mapped obstacle kept off by the route search, not scanned'
  // The words only: "not scanned" and its mark sit in a no-wrap span.
  const words = (html: string) => html.replace(/<[^>]+>/g, '')

  it('moves slope and mapped obstacle out of the plain list on a searched route, still "not scanned"', async () => {
    const searched = scanned(await planFastest(request, fixtureTerrain(() => 0), signal))
    const line = words(heading(renderToStaticMarkup(<HazardsPanel route={searched} />)))
    expect(line).toContain('Scanned for radiation: none found')
    expect(line).toContain(`not scanned for sudden drop, dust and temperature · ${KEPT_BOTH}`)
    expect(line).not.toContain('not scanned for steep slope')
    // The badge gives the search's own words, the ones its path method is built from.
    expect(line).toContain('DERIVED')
    expect(line).toContain('Steps over 20° (')
    expect(line).toContain('small craters and ridged ground are not avoided.')
  })

  it('keeps mapped obstacle in the plain list where the map was not read', async () => {
    const option = await planFastest(request, fixtureTerrain(() => 0, { mapFails: 'fixture map down' }), signal)
    const line = words(heading(renderToStaticMarkup(<HazardsPanel route={scanned(option)} />)))
    expect(line).toContain(
      'not scanned for sudden drop, dust, temperature and mapped obstacle · steep slope kept off by the route search, not scanned',
    )
    expect(line).not.toContain('Steps crossing a line')
  })

  it('says nothing was kept off for a route that was not searched', () => {
    for (const option of [route, pendingOption('fastest', REQUEST)]) {
      const html = renderToStaticMarkup(<HazardsPanel route={scanned(option)} />)
      expect(html).toContain('not scanned for steep slope, sudden drop, dust, temperature and mapped obstacle')
      expect(html).not.toContain('kept off')
    }
  })

  it('follows a list of hazards with the same coverage, as a sentence', async () => {
    const option = await planFastest(request, fixtureTerrain(() => 0), signal)
    const hazard = { id: 'h1', kind: 'slope' as const, coordinate: A, magnitude: derived(12, 'fixture slope'), unit: 'deg' }
    const html = renderToStaticMarkup(<HazardsPanel route={scanned(option, derived([hazard], 'fixture scan'))} />)
    const after = words(html.slice(html.indexOf('</ul>')))
    expect(after).toContain(`Not scanned for sudden drop, dust and temperature · ${KEPT_BOTH}`)
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
