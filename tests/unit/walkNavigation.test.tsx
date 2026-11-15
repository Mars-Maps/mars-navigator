import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { planRouteOnTerrain, planRouteOptions } from '../../src/app/planRoute'
import { WALK_ROUTE_STRATEGIES, canNavigateWalk, navigateWalk, walkRouteRequest } from '../../src/app/walkNavigation'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { DEFAULT_MISSION_SETTINGS, type RouteRequest, type WalkPlan } from '../../src/domain'
import { GoalPickerView } from '../../src/features/mission-ui/walk/GoalPicker'
import { useMissionStore } from '../../src/state'
import { defaultRouteOption } from '../../src/state/routeDraft'
import { at, fixtureTerrain, line } from './terrain.helpers'

const PLAN = SAMPLE_WALK_PLAN
const START = PLAN.stops[0].coordinate
const coordinates = PLAN.stops.map((s) => s.coordinate)

describe('walkRouteRequest', () => {
  it('starts and ends at the landing site, with the other stops between in walking order', () => {
    const request = walkRouteRequest(PLAN)!
    expect(request.departure).toEqual(START)
    expect(request.destination).toEqual(START)
    const last = coordinates[coordinates.length - 1]
    const endsAtStart = last.latitude === START.latitude && last.longitudeEast === START.longitudeEast
    expect(request.stops).toEqual(endsAtStart ? coordinates.slice(1, -1) : coordinates.slice(1))
  })

  it('keeps a walk that already returns to the landing site as the end, not as a stop', () => {
    const returning: WalkPlan = {
      ...PLAN,
      stops: [...PLAN.stops, { ...PLAN.stops[0], id: 'return' }],
      legs: [...PLAN.legs, PLAN.legs[0]],
    }
    expect(walkRouteRequest(returning)).toEqual(walkRouteRequest(PLAN))
  })

  it('answers null when there is no stop to walk to', () => {
    expect(walkRouteRequest({ ...PLAN, stops: [PLAN.stops[0]], legs: [] })).toBeNull()
    expect(walkRouteRequest({ ...PLAN, stops: [PLAN.stops[0], { ...PLAN.stops[0], id: 'return' }], legs: [PLAN.legs[0]] })).toBeNull()
    expect(walkRouteRequest({ ...PLAN, stops: [], legs: [] })).toBeNull()
  })
})

describe('a walk is navigated by the two searched strategies, with the straight line behind them', () => {
  const REQUEST: RouteRequest = { departure: at(0, 0), stops: [at(0.5, 0)], destination: at(0, 0) }
  const signal = new AbortController().signal

  it('offers the fastest and the energy-efficient route, then the straight line, and not the scientific one', () => {
    expect([...WALK_ROUTE_STRATEGIES]).toEqual(['fastest', 'energy-efficient', 'shortest'])
  })

  it('answers first with those alone, through the stops and back', () => {
    const options = planRouteOptions(REQUEST, WALK_ROUTE_STRATEGIES)
    expect(options.map((o) => o.strategy)).toEqual([...WALK_ROUTE_STRATEGIES])
    for (const option of options) {
      expect(option.points.map((p) => p.coordinate)).toEqual([at(0, 0), at(0.5, 0), at(0, 0)])
    }
  })

  it('searches the two on the terrain, and they are the first with a path', async () => {
    const planned = await planRouteOnTerrain(REQUEST, fixtureTerrain(() => 0), signal, WALK_ROUTE_STRATEGIES)
    expect(planned.map((o) => o.strategy)).toEqual([...WALK_ROUTE_STRATEGIES])
    for (const option of planned) expect(option.path.classification).toBe('DERIVED')
    expect(defaultRouteOption(planned)?.strategy).toBe('fastest')
  })

  it('still has a route to draw where neither search finds a way: the straight line the walk measured', async () => {
    // A mapped rim crest right across the leg: the searches keep off it, a walk's straight leg only flags it.
    const walled = fixtureTerrain(() => 0, { lines: [line('crest of crater rim', [0.25, -5], [0.25, 5])] })
    const planned = await planRouteOnTerrain(REQUEST, walled, signal, WALK_ROUTE_STRATEGIES)
    expect(planned.slice(0, 2).map((o) => o.path.classification)).toEqual(['UNAVAILABLE', 'UNAVAILABLE'])
    expect(defaultRouteOption(planned)?.strategy).toBe('shortest')
    expect(defaultRouteOption(planned)?.path.classification).toBe('DERIVED')
  })
})

describe('canNavigateWalk', () => {
  it('hands a walk to navigation from close-up only', () => {
    expect(canNavigateWalk('close-up')).toBe(true)
    expect(canNavigateWalk('welcome')).toBe(false)
    expect(canNavigateWalk('surface')).toBe(false)
  })

  it('does not replace a route already being followed', () => {
    expect(canNavigateWalk('navigation')).toBe(false)
  })
})

describe('navigateWalk', () => {
  const FOLLOWED = { departure: at(3, 3), destination: at(4, 4), stops: [] }
  const reset = (viewMode: 'welcome' | 'close-up' | 'navigation') =>
    useMissionStore.setState({ ...useMissionStore.getInitialState(), viewMode, routeDraft: FOLLOWED, activeToolId: 'plan-walk' })

  it('from close-up, sets the draft to the walk and asks for its route', () => {
    reset('close-up')
    const asked: RouteRequest[] = []
    navigateWalk(PLAN, (request) => asked.push(request))
    expect(asked).toEqual([walkRouteRequest(PLAN)])
    expect(useMissionStore.getState().routeDraft.departure).toEqual(START)
    expect(useMissionStore.getState().routeDraft.destination).toEqual(START)
  })

  it('leaves a route being followed, and its draft, as they are', () => {
    reset('navigation')
    const asked: RouteRequest[] = []
    navigateWalk(PLAN, (request) => asked.push(request))
    expect(asked).toEqual([])
    expect(useMissionStore.getState().routeDraft).toEqual(FOLLOWED)
    expect(useMissionStore.getState().activeToolId).toBe('plan-walk')
  })

  it('does nothing from the welcome screen', () => {
    reset('welcome')
    const asked: RouteRequest[] = []
    navigateWalk(PLAN, (request) => asked.push(request))
    expect(asked).toEqual([])
    expect(useMissionStore.getState().routeDraft).toEqual(FOLLOWED)
  })
})

describe('GoalPickerView hands the selected walk to navigation', () => {
  const render = (canNavigate: boolean, onNavigate?: () => void) =>
    renderToStaticMarkup(
      <GoalPickerView
        step="walks"
        onStep={() => {}}
        landing={START}
        landingProblem={null}
        picking={false}
        settings={DEFAULT_MISSION_SETTINGS}
        onSettings={() => {}}
        onCancelPick={() => {}}
        plan={PLAN}
        status={{ kind: 'idle' }}
        onPlan={() => {}}
        canStand
        onStand={() => {}}
        canNavigate={canNavigate}
        onNavigate={onNavigate}
      />,
    )
  const button = (html: string) => html.match(/<button[^>]*>Navigate this walk<\/button>/)?.[0]

  it('shows the button, enabled, when navigation can be entered', () => {
    const html = button(render(true, () => {}))
    expect(html).toBeDefined()
    expect(html).not.toContain('disabled=""')
  })

  it('disables the button when navigation cannot be entered, and says what to do', () => {
    const html = render(false, () => {})
    expect(button(html)).toContain('disabled=""')
    expect(html).toContain('end the route being followed first')
    expect(render(true, () => {})).not.toContain('end the route being followed first')
  })

  it('shows no button when the shell gives nothing to navigate with', () => {
    expect(render(true)).not.toContain('Navigate this walk')
  })
})
