import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { planRouteOnTerrain, planRouteOptions } from '../../src/app/planRoute'
import { WALK_ROUTE_STRATEGIES, walkRouteRequest } from '../../src/app/walkNavigation'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { DEFAULT_MISSION_SETTINGS, type RouteRequest, type WalkPlan } from '../../src/domain'
import { GoalPickerView } from '../../src/features/mission-ui/walk/GoalPicker'
import { at, fixtureTerrain } from './terrain.helpers'

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

describe('a walk is navigated by two strategies only', () => {
  const REQUEST: RouteRequest = { departure: at(0, 0), stops: [at(0.5, 0)], destination: at(0, 0) }

  it('offers the fastest and the energy-efficient route', () => {
    expect([...WALK_ROUTE_STRATEGIES]).toEqual(['fastest', 'energy-efficient'])
  })

  it('answers first with those two alone, through the stops and back', () => {
    const options = planRouteOptions(REQUEST, WALK_ROUTE_STRATEGIES)
    expect(options.map((o) => o.strategy)).toEqual(['fastest', 'energy-efficient'])
    for (const option of options) {
      expect(option.points.map((p) => p.coordinate)).toEqual([at(0, 0), at(0.5, 0), at(0, 0)])
    }
  })

  it('searches those two alone on the terrain', async () => {
    const planned = await planRouteOnTerrain(REQUEST, fixtureTerrain(() => 0), new AbortController().signal, WALK_ROUTE_STRATEGIES)
    expect(planned.map((o) => o.strategy)).toEqual(['fastest', 'energy-efficient'])
    for (const option of planned) expect(option.path.classification).toBe('DERIVED')
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

  it('disables the button when navigation cannot be entered', () => {
    expect(button(render(false, () => {}))).toContain('disabled=""')
  })

  it('shows no button when the shell gives nothing to navigate with', () => {
    expect(render(true)).not.toContain('Navigate this walk')
  })
})
