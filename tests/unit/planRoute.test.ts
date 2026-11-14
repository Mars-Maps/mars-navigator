import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { derived, isAvailable, type MarsCoordinate, type RouteOption, type RouteRequest } from '../../src/domain'
import { planRouteOnTerrain, planRouteOptions } from '../../src/app/planRoute'
import { DestinationBar } from '../../src/features/mission-ui/navigation/DestinationBar'
import { STRATEGY_LABEL } from '../../src/features/mission-ui/navigation/labels'
import { FASTEST_PENDING_REASON } from '../../src/features/route-analysis/strategies/fastest'
import { STRATEGY_ORDER } from '../../src/features/route-analysis/strategies/registry'
import { defaultRouteOption, replacedRouteOptions, useMissionStore } from '../../src/state'
import { at, fixtureTerrain } from './terrain.helpers'

// Test fixtures only: invented coordinates.
const A: MarsCoordinate = { latitude: 0, longitudeEast: 0 }
const B: MarsCoordinate = { latitude: 5, longitudeEast: 5 }
const D: MarsCoordinate = { latitude: 10, longitudeEast: 10 }
const REQUEST: RouteRequest = { departure: A, stops: [B], destination: D }

const state = () => useMissionStore.getState()
const shortestOf = (options: readonly RouteOption[]) => options.find((o) => o.strategy === 'shortest')!
const fastestOf = (options: readonly RouteOption[]) => options.find((o) => o.strategy === 'fastest')!
/** A short leg on the fixture terrain, so the search is small. */
const JEZERO: RouteRequest = { departure: at(0, 0), stops: [], destination: at(0.5, 0) }
const signal = new AbortController().signal

describe('planRouteOptions', () => {
  it('answers with every strategy, in the registry order', () => {
    expect(planRouteOptions(REQUEST).map((o) => o.strategy)).toEqual([...STRATEGY_ORDER])
  })

  it('gives every option the requested waypoints in order', () => {
    for (const option of planRouteOptions(REQUEST)) {
      expect(option.points.map((p) => p.coordinate)).toEqual([A, B, D])
    }
  })

  it('draws exactly one option today, the shortest distance, with its method', () => {
    const options = planRouteOptions(REQUEST)
    const drawn = options.filter((o) => isAvailable(o.path))
    expect(drawn.map((o) => o.strategy)).toEqual(['shortest'])
    const path = drawn[0].path
    if (!isAvailable(path)) throw new Error('unreachable')
    expect(path.classification).toBe('DERIVED')
    expect(path.value.map((p) => p.coordinate)).toEqual([A, B, D])
  })

  it('lists the three searched strategies as being planned', () => {
    const options = planRouteOptions(REQUEST)
    const scientific = options.find((o) => o.strategy === 'scientific')!
    expect(scientific.path).toEqual({ classification: 'UNAVAILABLE', reason: FASTEST_PENDING_REASON })
    expect(fastestOf(options).path).toEqual({ classification: 'UNAVAILABLE', reason: FASTEST_PENDING_REASON })
    const energy = options.find((o) => o.strategy === 'energy-efficient')!
    expect(energy.path).toEqual({ classification: 'UNAVAILABLE', reason: FASTEST_PENDING_REASON })
  })

  it('invents no time or energy for any option', () => {
    for (const { metrics, hazards } of planRouteOptions(REQUEST)) {
      expect(isAvailable(metrics.durationHours)).toBe(false)
      expect(isAvailable(metrics.metabolicEnergyKcal)).toBe(false)
      expect(isAvailable(hazards)).toBe(false)
    }
  })
})

describe('defaultRouteOption', () => {
  it('is the first option with a DERIVED path, wherever it is listed', () => {
    const options = planRouteOptions(REQUEST)
    expect(defaultRouteOption(options)).toBe(shortestOf(options))
    expect(defaultRouteOption([...options].reverse())).toBe(shortestOf(options))
  })

  it('falls back to the first listed when none is drawn, and null for none', () => {
    const undrawn = planRouteOptions(REQUEST).filter((o) => !isAvailable(o.path))
    expect(defaultRouteOption(undrawn)).toBe(undrawn[0])
    expect(defaultRouteOption([])).toBeNull()
  })
})

describe('startNavigation, selectRouteOption and endNavigation', () => {
  beforeEach(() => {
    // Set directly, as cameraViewMode.test.ts does: the path a previous
    // test left the store on does not matter.
    useMissionStore.setState({ viewMode: 'close-up', activeRoute: null, routeOptions: [], introDismissed: true })
    state().clearRoute()
    state().setDeparture(A)
    state().addStop(B)
    state().setDestination(D)
  })

  it('keeps the options, selects the drawn one and enters navigation together from close-up', () => {
    const options = planRouteOptions(REQUEST)
    state().startNavigation(options)
    expect(state().routeOptions).toEqual(options)
    expect(state().activeRoute).toBe(shortestOf(options))
    expect(state().viewMode).toBe('navigation')
  })

  it('changes nothing for an empty list, so navigation never starts with no route', () => {
    state().startNavigation([])
    expect(state().activeRoute).toBeNull()
    expect(state().routeOptions).toEqual([])
    expect(state().viewMode).toBe('close-up')
  })

  it('changes nothing from welcome, so a route is never active out of reach', () => {
    state().setViewMode('welcome')
    state().startNavigation(planRouteOptions(REQUEST))
    expect(state().activeRoute).toBeNull()
    expect(state().routeOptions).toEqual([])
    expect(state().viewMode).toBe('welcome')
  })

  it('selects another listed option while navigating, drawn or not', () => {
    const options = planRouteOptions(REQUEST)
    state().startNavigation(options)
    state().selectRouteOption('option-fastest')
    expect(state().activeRoute).toBe(options.find((o) => o.id === 'option-fastest'))
    expect(state().viewMode).toBe('navigation')
    state().selectRouteOption('option-shortest')
    expect(state().activeRoute).toBe(shortestOf(options))
  })

  it('ignores an id that is not listed, so the active route is always one of the options', () => {
    const options = planRouteOptions(REQUEST)
    state().startNavigation(options)
    state().selectRouteOption('option-made-up')
    expect(state().activeRoute).toBe(shortestOf(options))
  })

  it('ignores a selection outside navigation', () => {
    state().selectRouteOption('option-shortest')
    expect(state().activeRoute).toBeNull()
    expect(state().viewMode).toBe('close-up')
  })

  it('ends navigation into close-up, clearing the route and options and keeping the draft', () => {
    state().startNavigation(planRouteOptions(REQUEST))
    state().endNavigation()
    expect(state().activeRoute).toBeNull()
    expect(state().routeOptions).toEqual([])
    expect(state().viewMode).toBe('close-up')
    expect(state().routeDraft).toEqual({ departure: A, stops: [B], destination: D })
  })

  it('does nothing when not navigating', () => {
    state().endNavigation()
    expect(state().viewMode).toBe('close-up')
    expect(state().routeDraft.departure).toEqual(A)
  })

  it('replaces the options when started again while navigating, staying in navigation', () => {
    state().startNavigation(planRouteOptions(REQUEST))
    const next = planRouteOptions({ departure: D, stops: [], destination: A })
    state().startNavigation(next)
    expect(state().routeOptions).toEqual(next)
    expect(state().activeRoute).toBe(shortestOf(next))
    expect(state().viewMode).toBe('navigation')
  })

  it('leaves introDismissed alone on start and end', () => {
    state().startNavigation(planRouteOptions(REQUEST))
    state().endNavigation()
    expect(state().introDismissed).toBe(true)
  })

  it('clearRoute in navigation also leaves it, clearing the options', () => {
    state().startNavigation(planRouteOptions(REQUEST))
    state().clearRoute()
    expect(state().activeRoute).toBeNull()
    expect(state().routeOptions).toEqual([])
    expect(state().viewMode).toBe('close-up')
  })

  it('clearRoute outside navigation keeps the mode', () => {
    state().clearRoute()
    expect(state().viewMode).toBe('close-up')
  })
})

describe('DestinationBar heading, picker and exit', () => {
  const options = planRouteOptions(REQUEST)
  const render = (route: RouteOption | null, offered: readonly RouteOption[] = options) =>
    renderToStaticMarkup(
      createElement(DestinationBar, { route, options: offered, onSelect: () => {}, onEnd: () => {} }),
    )

  it('names the strategy only for a route with a drawn path', () => {
    expect(render(shortestOf(options))).toContain('Shortest distance route')
    const fastest = options.find((o) => o.strategy === 'fastest')!
    const html = render(fastest)
    expect(html).toContain('Not yet planned')
    expect(html).not.toContain('Fastest route')
  })

  it('lists every option as a native radio in one group, the active one checked', () => {
    const html = render(shortestOf(options))
    expect(html).toContain('Route options')
    expect(html.match(/type="radio"/g)).toHaveLength(options.length)
    expect(html.match(/checked=""/g)).toHaveLength(1)
    // One group: every radio shares the name.
    const names = [...html.matchAll(/<input[^>]*type="radio"[^>]*name="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(1)
    for (const option of options) expect(html).toContain(STRATEGY_LABEL[option.strategy])
    // In the registry order.
    const at = options.map((o) => html.indexOf(`>${STRATEGY_LABEL[o.strategy]}<`))
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('shows the drawn option\'s distance and says the others are still being searched, with their reasons', () => {
    const html = render(shortestOf(options))
    // Right after Plan route the three searched options are placeholders: searching, not failed.
    expect(html.match(/Searching…/g)).toHaveLength(3)
    expect(html).not.toContain('Not drawn')
    expect(html).toContain(FASTEST_PENDING_REASON)
    // The shortest option's distance is a DERIVED number, never 0.
    expect(html).toMatch(/\d+\.\d km/)
    expect(html).not.toMatch(/>0\.0 km</)
  })

  it('says "Not drawn" for a search that found no path, never "Searching…"', () => {
    // Test fixture only: the Fastest option as a failed search leaves it, its path UNAVAILABLE with its own reason.
    const failed = options.map((o) =>
      o.strategy === 'fastest' ? { ...o, path: { classification: 'UNAVAILABLE' as const, reason: 'fixture: no path within the slope limit' } } : o,
    )
    const html = render(shortestOf(failed), failed)
    expect(html.match(/Not drawn/g)).toHaveLength(1)
    expect(html).toContain('fixture: no path within the slope limit')
    expect(html.match(/Searching…/g)).toHaveLength(2)
  })

  it('shows the units a route crosses, named, only when the route states them', () => {
    const route = shortestOf(options)
    expect(render(route)).not.toContain('Geologic units crossed')
    const withUnits: RouteOption = {
      ...route,
      metrics: { ...route.metrics, unitsCrossed: derived(['Jezero floor unit', 'Jezero fan 1 unit'], 'fixture method') },
    }
    const html = render(withUnits)
    expect(html).toContain('Geologic units crossed')
    expect(html).toContain('2: Jezero floor unit, Jezero fan 1 unit')
  })

  it('shows no picker for a single option', () => {
    const only = shortestOf(options)
    expect(render(only, [only])).not.toContain('type="radio"')
  })

  it('offers End navigation with a route and, as a backstop, without one', () => {
    expect(render(shortestOf(options))).toContain('End navigation')
    expect(render(null)).toContain('End navigation')
  })

  it("puts End navigation in the bar's header, boxed so it never reads as a caption", () => {
    for (const html of [render(shortestOf(options)), render(null)]) {
      // In the header, after the heading, before the body.
      expect(html).toMatch(/<header[^>]*>.*End navigation<\/button><\/header>/)
      const button = html.match(/<button[^>]*>End navigation/)![0]
      expect(button).toContain('border-accent/40')
      expect(button).toContain('bg-accent/10')
    }
  })
})

describe('planRouteOnTerrain', () => {
  it('replaces the searched options with their answers and keeps the rest as first answered', async () => {
    const first = planRouteOptions(JEZERO)
    const planned = await planRouteOnTerrain(JEZERO, fixtureTerrain(() => 0), signal)
    expect(planned.map((o) => o.strategy)).toEqual([...STRATEGY_ORDER])
    expect(fastestOf(planned).path.classification).toBe('DERIVED')
    expect(isAvailable(fastestOf(planned).metrics.durationHours)).toBe(true)
    const energy = planned.find((o) => o.strategy === 'energy-efficient')!
    expect(energy.path.classification).toBe('DERIVED')
    expect(isAvailable(energy.metrics.metabolicEnergyKcal)).toBe(true)
    // With no unit polygons in the fixture, the scientific route says why it has no path.
    const scientific = planned.find((o) => o.strategy === 'scientific')!
    expect(scientific.path).toEqual({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/no units within 5 km of this route/) })
    for (const option of planned) {
      if (option.strategy === 'shortest') {
        expect(option).toEqual(first.find((o) => o.strategy === option.strategy))
      }
    }
  })

  it('turns a search that throws into an option that says so, never a rejected list', async () => {
    const terrain = fixtureTerrain(() => 0)
    terrain.heights = () => Promise.reject(new Error('boom'))
    const planned = await planRouteOnTerrain(JEZERO, terrain, signal)
    expect(fastestOf(planned).path).toEqual({ classification: 'UNAVAILABLE', reason: 'The planner failed: boom' })
    expect(fastestOf(planned).metrics.durationHours).toEqual({ classification: 'UNAVAILABLE', reason: 'The planner failed: boom' })
    expect(fastestOf(planned).metrics.metabolicEnergyKcal).toEqual({ classification: 'UNAVAILABLE', reason: 'The planner failed: boom' })
    const energy = planned.find((o) => o.strategy === 'energy-efficient')!
    expect(energy.metrics.metabolicEnergyKcal).toEqual({ classification: 'UNAVAILABLE', reason: 'The planner failed: boom' })
  })

  it('answers with the first answers again when cancelled, for the caller to drop', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    const planned = await planRouteOnTerrain(JEZERO, fixtureTerrain(() => 0), cancelled.signal)
    expect(planned).toEqual(planRouteOptions(JEZERO))
  })
})

describe('replaceRouteOptions', () => {
  let first: RouteOption[]
  let planned: RouteOption[]
  beforeEach(async () => {
    useMissionStore.setState({ viewMode: 'close-up', activeRoute: null, routeOptions: [], introDismissed: true })
    first = planRouteOptions(JEZERO)
    planned = await planRouteOnTerrain(JEZERO, fixtureTerrain(() => 0), signal)
  })

  it('moves a user still on the default to the new default, so the fastest route is drawn when it arrives', () => {
    state().startNavigation(first)
    expect(state().activeRoute).toBe(shortestOf(first))
    state().replaceRouteOptions(planned)
    expect(state().routeOptions).toEqual(planned)
    expect(state().activeRoute).toBe(fastestOf(planned))
    expect(state().viewMode).toBe('navigation')
  })

  it('keeps an option the user chose, by id, now with its planned body', () => {
    state().startNavigation(first)
    state().selectRouteOption('option-scientific')
    state().replaceRouteOptions(planned)
    expect(state().activeRoute).toBe(planned.find((o) => o.id === 'option-scientific'))
  })

  it('gives a user who chose the pending fastest route its planned body', () => {
    state().startNavigation(first)
    state().selectRouteOption('option-fastest')
    expect(state().activeRoute).toBe(fastestOf(first))
    state().replaceRouteOptions(planned)
    expect(state().activeRoute).toBe(fastestOf(planned))
  })

  it('is the pure rule replacedRouteOptions, null when nothing changes', () => {
    expect(replacedRouteOptions({ viewMode: 'close-up', surfaceReturn: 'close-up', activeRoute: shortestOf(first), routeOptions: first }, planned)).toBeNull()
    expect(replacedRouteOptions({ viewMode: 'navigation', surfaceReturn: 'close-up', activeRoute: null, routeOptions: [] }, planned)).toBeNull()
    expect(replacedRouteOptions({ viewMode: 'navigation', surfaceReturn: 'close-up', activeRoute: shortestOf(first), routeOptions: first }, [])).toBeNull()
    const moved = replacedRouteOptions({ viewMode: 'navigation', surfaceReturn: 'close-up', activeRoute: shortestOf(first), routeOptions: first }, planned)
    expect(moved?.activeRoute).toBe(fastestOf(planned))
    expect(moved?.routeOptions).toEqual(planned)
  })

  // Before, a search that landed while the walker stood on the route was dropped, and the
  // options said "Searching…" for good once the walker came back.
  it('lands while the walker stands on the route, and the walker keeps the route under their feet', () => {
    state().startNavigation(first)
    state().enterSurface(JEZERO.departure)
    expect(state().viewMode).toBe('surface')
    expect(state().surfaceReturn).toBe('navigation')
    state().replaceRouteOptions(planned)
    expect(state().routeOptions).toEqual(planned)
    // Not moved to the new default: the drop snapped the walker to this route's line.
    expect(state().activeRoute).toBe(shortestOf(planned))
    expect(state().viewMode).toBe('surface')
    state().leaveSurface()
    expect(state().viewMode).toBe('navigation')
    expect(isAvailable(fastestOf(state().routeOptions).path)).toBe(true)
  })

  it('gives a walker standing on a chosen option its planned body, by id', () => {
    state().startNavigation(first)
    state().selectRouteOption('option-scientific')
    state().enterSurface(JEZERO.departure)
    state().replaceRouteOptions(planned)
    expect(state().activeRoute).toBe(planned.find((o) => o.id === 'option-scientific'))
  })

  it('does not land on a surface view entered from close-up, where no route is followed', () => {
    const base = { activeRoute: shortestOf(first), routeOptions: first }
    expect(replacedRouteOptions({ ...base, viewMode: 'surface', surfaceReturn: 'close-up' }, planned)).toBeNull()
    const landed = replacedRouteOptions({ ...base, viewMode: 'surface', surfaceReturn: 'navigation' }, planned)
    expect(landed?.activeRoute).toBe(shortestOf(planned))
  })

  it('changes nothing outside navigation, for an empty list, or when the chosen id is gone', () => {
    state().replaceRouteOptions(planned)
    expect(state().activeRoute).toBeNull()
    expect(state().routeOptions).toEqual([])
    state().startNavigation(first)
    state().replaceRouteOptions([])
    expect(state().routeOptions).toEqual(first)
    state().selectRouteOption('option-scientific')
    state().replaceRouteOptions(planned.filter((o) => o.id !== 'option-scientific'))
    expect(state().routeOptions).toEqual(first)
    expect(state().activeRoute).toBe(first.find((o) => o.id === 'option-scientific'))
  })
})
