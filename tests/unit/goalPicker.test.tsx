import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { derived, unavailable, type WalkPlan } from '../../src/domain'
import { SCIENCE_GOALS } from '../../src/features/route-analysis/scienceGoals'
import { GoalPickerView, type PlanStatus } from '../../src/features/mission-ui/walk/GoalPicker'
import type { WalkStart } from '../../src/features/mission-ui/walk/walkStart'

const START: WalkStart = { coordinate: { latitude: 18.44, longitudeEast: 77.45 }, from: 'departure' }

const render = (props: { canStand?: boolean; start?: WalkStart | null; plan?: WalkPlan | null; status?: PlanStatus }) =>
  renderToStaticMarkup(
    <GoalPickerView
      goals={SCIENCE_GOALS}
      start={props.start === undefined ? START : props.start}
      plan={props.plan ?? null}
      status={props.status ?? { kind: 'idle' }}
      onPlan={() => {}}
      canStand={props.canStand ?? true}
      onStand={() => {}}
    />,
  )

describe('GoalPickerView', () => {
  it('lists every goal and says where the walk starts', () => {
    const html = render({})
    for (const g of SCIENCE_GOALS) expect(html).toContain(g.label)
    expect(html).toContain('Starts at your departure')
    expect(html).toContain('18.440°N 77.450°E')
  })

  it('offers to stand at the start only with a plan, and says why not while navigating', () => {
    expect(render({})).not.toContain('Stand at the start')
    const open = render({ plan: SAMPLE_WALK_PLAN })
    expect(open).toMatch(/<button type="button"(?! disabled)[^>]*>Stand at the start<\/button>/)
    expect(open).not.toContain('End navigation')
    const navigating = render({ plan: SAMPLE_WALK_PLAN, canStand: false })
    expect(navigating).toMatch(/<button type="button" disabled=""[^>]*>Stand at the start<\/button>/)
    expect(navigating).toContain('End navigation to stand on the ground.')
  })

  it('makes Stand at the start the panel’s highlighted button, and plain while it cannot be used', () => {
    const tag = (html: string) => html.match(/<button[^>]*>Stand at the start<\/button>/)![0]
    const ready = tag(render({ plan: SAMPLE_WALK_PLAN }))
    expect(ready).not.toContain('disabled=""')
    for (const c of ['w-full', 'bg-accent/15', 'text-accent', 'font-medium', 'border-accent/50']) expect(ready).toContain(c)
    // Disabled during navigation it drops the accent, so it never reads as the next step.
    const navigating = tag(render({ plan: SAMPLE_WALK_PLAN, canStand: false }))
    expect(navigating).toContain('disabled=""')
    for (const c of ['disabled:bg-transparent', 'disabled:border-line', 'disabled:text-ink-subtle/60']) expect(navigating).toContain(c)
  })

  it('puts Stand at the start above the stops, so a long plan does not push it out of view', () => {
    const html = render({ plan: SAMPLE_WALK_PLAN })
    expect(html.indexOf('Stand at the start')).toBeLessThan(html.indexOf(`>${SAMPLE_WALK_PLAN.stops[0].label}<`))
  })

  it('says a leg flags and does not avoid, shows the diagram, and says why a leg is not drawn', () => {
    expect(render({ plan: SAMPLE_WALK_PLAN })).toContain('it does not go around them')
    expect(render({ plan: SAMPLE_WALK_PLAN })).toContain('Diagram, no imagery')
    expect(render({ plan: SAMPLE_WALK_PLAN })).not.toContain('Leg not drawn')
    const noPath: WalkPlan = {
      ...SAMPLE_WALK_PLAN,
      legs: SAMPLE_WALK_PLAN.legs.map((leg, i) => (i === 0 ? { ...leg, path: unavailable('No path for this leg') } : leg)),
    }
    expect(render({ plan: noPath })).toContain('Leg not drawn: No path for this leg')
    const sameReason: WalkPlan = {
      ...SAMPLE_WALK_PLAN,
      legs: SAMPLE_WALK_PLAN.legs.map((leg, i) =>
        i === 0 ? { ...leg, path: unavailable('Not planned'), distanceKm: unavailable('Not planned') } : leg,
      ),
    }
    expect(render({ plan: sameReason })).toContain('Leg not drawn</p>')
  })

  it('keeps the status line mounted when idle, so its words are announced when they come', () => {
    expect(render({})).toMatch(/<p role="status" class="sr-only"><\/p>/)
  })

  it('asks for a start, with Plan disabled, when there is none', () => {
    const html = render({ start: null })
    expect(html).toMatch(/Pick a departure on the globe, set one in the search bar/)
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Plan<\/button>/)
  })

  it('shows Planning… while it plans, and why it could not', () => {
    expect(render({ status: { kind: 'planning' } })).toContain('Planning…')
    expect(render({ status: { kind: 'planning' } })).toContain('can take about 20 s')
    expect(render({})).not.toContain('can take about 20 s')
    expect(render({ status: { kind: 'failed', reason: 'fixture reason' } })).toContain('Could not plan: fixture reason')
  })

  it('says the plan on show is the previous one when a new one could not be made', () => {
    const status: PlanStatus = { kind: 'failed', reason: 'fixture reason' }
    expect(render({ status })).not.toContain('previous one')
    expect(render({ status, plan: SAMPLE_WALK_PLAN })).toContain('The plan below is the previous one.')
  })

  it('shows the plan’s stops with each leg’s own distance', () => {
    const legs = SAMPLE_WALK_PLAN.legs.map((leg, i) => ({ ...leg, distanceKm: derived(0.4 + i, 'fixture') }))
    const html = render({ plan: { ...SAMPLE_WALK_PLAN, legs } })
    // The start is not counted as a stop: Start, then Stop 1 … Stop n.
    expect(html).toContain(`, the start and ${SAMPLE_WALK_PLAN.stops.length - 1} stops`)
    expect(html).toContain('0.40 km')
    expect(html.match(/<li /g)).toHaveLength(SAMPLE_WALK_PLAN.stops.length)
  })

  it('shows where the plan starts, and the limit it was checked against with its label and citation', () => {
    const html = render({ plan: SAMPLE_WALK_PLAN })
    const { latitude } = SAMPLE_WALK_PLAN.stops[0].coordinate
    expect(html).toContain(`${latitude.toFixed(3)}°N`)
    expect(html).toContain('Slope limit 20°: lunar xEVA figure, not a Mars requirement')
    expect(html).toContain('EVA-EXP-0075')
    expect(html).toContain('a flag means look here, not impassable')
  })

  it('puts each leg under the stop it reaches, and none under the start', () => {
    const [first, second] = SAMPLE_WALK_PLAN.legs
    const legs = [
      { ...first, steepestSlopeDeg: derived(11.1, 'fixture') },
      { ...second, steepestSlopeDeg: derived(22.2, 'fixture') },
    ]
    const html = render({ plan: { ...SAMPLE_WALK_PLAN, legs } })
    const at = (text: string) => html.indexOf(text)
    const [start, stop2, stop3] = SAMPLE_WALK_PLAN.stops.map((s) => at(`>${s.label}<`))
    for (const found of [start, stop2, stop3]) expect(found).toBeGreaterThan(-1)
    expect(html.match(/Steepest slope/g)).toHaveLength(legs.length)
    expect(at('Steepest slope')).toBeGreaterThan(stop2)
    expect(at('11.1°')).toBeGreaterThan(stop2)
    expect(at('11.1°')).toBeLessThan(stop3)
    expect(at('22.2°')).toBeGreaterThan(stop3)
  })

  it('with a plan from elsewhere (the sample walk), still picks a goal and lets you plan', () => {
    const html = render({ plan: SAMPLE_WALK_PLAN })
    expect(html).toContain(`<input type="radio" name="walk-goal" checked="" value="${SCIENCE_GOALS[0].id}"/>`)
    expect(html).toMatch(/<button type="button" class="[^"]*">Plan<\/button>/)
  })

  it('marks the planned goal with its own classification', () => {
    expect(render({ plan: SAMPLE_WALK_PLAN })).toMatch(/Planned: .*?<span class="sr-only">SIMULATED<\/span>/)
  })
})
