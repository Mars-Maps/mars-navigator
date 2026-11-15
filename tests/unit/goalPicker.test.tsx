import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { derived, unavailable, type WalkPlan } from '../../src/domain'
import { SCIENCE_GOALS } from '../../src/features/route-analysis/scienceGoals'
import { GoalPickerView, type PlanStatus } from '../../src/features/mission-ui/walk/GoalPicker'
import { LandingStep, type LandingReading } from '../../src/features/mission-ui/walk/LandingStep'
import { DEFAULT_MISSION_SETTINGS, type MissionSettings } from '../../src/features/mission-ui/walk/missionSettings'
import { firstStep, shownStep, stepOpen, type WalkStep } from '../../src/features/mission-ui/walk/walkSteps'
import type { Classified, MarsCoordinate } from '../../src/domain'
import { methodologyText, visibleText } from './methodology.helpers'

const LANDING: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }

// The step defaults to where the shell would open it: the walks with a plan, else the settings.
const render = (props: {
  canStand?: boolean
  landing?: MarsCoordinate | null
  landingProblem?: string | null
  plan?: WalkPlan | null
  status?: PlanStatus
  step?: WalkStep
  picking?: boolean
  canPick?: boolean
  settings?: MissionSettings
  useSelected?: boolean
}) =>
  renderToStaticMarkup(
    <GoalPickerView
      step={props.step ?? (props.plan ? 'walks' : 'settings')}
      onStep={() => {}}
      landing={props.landing === undefined ? LANDING : props.landing}
      landingProblem={props.landingProblem ?? null}
      picking={props.picking ?? false}
      onPickLanding={props.canPick === false ? undefined : () => {}}
      settings={props.settings ?? DEFAULT_MISSION_SETTINGS}
      onSettings={() => {}}
      onCancelPick={() => {}}
      onUseSelected={props.useSelected ? () => {} : undefined}
      plan={props.plan ?? null}
      status={props.status ?? { kind: 'idle' }}
      onPlan={() => {}}
      canStand={props.canStand ?? true}
      onStand={() => {}}
    />,
  )

describe('GoalPickerView', () => {
  it('asks for no goal, and says where the walk lands', () => {
    const html = render({})
    expect(html).not.toContain('walk-goal')
    for (const g of SCIENCE_GOALS) expect(html).not.toContain(`>${g.label}<`)
    expect(html).toContain('Lands at')
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

  it('shows Planning… while it plans, and why it could not', () => {
    expect(render({ status: { kind: 'planning' } })).toContain('Planning…')
    expect(render({ status: { kind: 'planning' } })).toContain('can take about half a minute')
    expect(render({})).not.toContain('can take about half a minute')
    expect(render({ status: { kind: 'failed', reason: 'fixture reason' } })).toContain('Could not plan: fixture reason')
  })

  it('says the plan on show is the previous one when a new one could not be made', () => {
    const status: PlanStatus = { kind: 'failed', reason: 'fixture reason' }
    expect(render({ status })).not.toContain('previous one')
    expect(render({ status, plan: SAMPLE_WALK_PLAN })).toContain('The plan under Walks is the previous one.')
  })

  it('shows the plan’s stops with each leg’s own distance', () => {
    const legs = SAMPLE_WALK_PLAN.legs.map((leg, i) => ({ ...leg, distanceKm: derived(0.4 + i, 'fixture') }))
    const html = render({ plan: { ...SAMPLE_WALK_PLAN, legs } })
    // The start is not counted as a stop: Start, then Stop 1 … Stop n.
    expect(html).toContain(`, the start and ${SAMPLE_WALK_PLAN.stops.length - 1} stops`)
    expect(html).toContain('0.40 km')
    // The stops' own items, apart from the three step buttons'.
    expect(html.match(/<li class="flex flex-col/g)).toHaveLength(SAMPLE_WALK_PLAN.stops.length)
  })

  it('shows where the plan starts and its slope limit; how the walk is checked is behind the Methodology button', () => {
    const html = render({ plan: SAMPLE_WALK_PLAN })
    const { latitude } = SAMPLE_WALK_PLAN.stops[0].coordinate
    expect(html).toContain(`${latitude.toFixed(3)}°N`)
    expect(visibleText(html)).toContain('Slope limit 20°')
    expect(html).toContain('EVA-EXP-0075')
    // The label, how slopes are measured and what a leg is: one click away, not three paragraphs.
    expect(visibleText(html)).not.toContain('a flag means look here')
    expect(visibleText(html)).not.toContain('Each leg is a straight line')
    const more = methodologyText(html)
    expect(more).toContain('How the walk is checked')
    expect(more).toContain('20°: lunar xEVA figure, not a Mars requirement')
    expect(more).toContain('a flag means look here, not impassable')
    expect(more).toContain('it does not go around them')
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

  it('with a plan from elsewhere (the sample walk), still lets you plan', () => {
    const html = render({ plan: SAMPLE_WALK_PLAN, step: 'settings' })
    expect(html).toMatch(/<button type="button" class="[^"]*">Plan walks<\/button>/)
  })

  it('marks the planned goal with its own classification', () => {
    expect(render({ plan: SAMPLE_WALK_PLAN })).toMatch(/Planned: .*?<span class="sr-only">SIMULATED<\/span>/)
  })
})

describe('Plan a walk in steps', () => {
  const stepButton = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>\\d\\. ${label}</button>`))![0]

  it('opens on the landing site and asks for a click on the map', () => {
    const html = render({ step: 'landing', landing: null, picking: false })
    expect(html).toContain('No landing site yet.')
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Next<\/button>/)
    // Plan belongs to the next step.
    expect(html).not.toContain('Plan walks')
  })

  it('folds to its bar while the pick waits for its first click, so the colours under it show', () => {
    const waiting = render({ step: 'landing', landing: null, picking: true })
    expect(waiting).toContain('Plan a walk')
    expect(waiting).not.toContain('No landing site yet.')
    expect(waiting).not.toContain('>Next<')
    // Once a site is set it opens, with the site and a word on moving it.
    const set = render({ step: 'landing', picking: true })
    expect(set).toContain('Landing site:')
    expect(set).toContain('Click the map again to move it.')
  })

  it('names the three steps, marks the one on show, and opens only those that can be', () => {
    const html = render({ step: 'landing', landing: null })
    expect(stepButton(html, 'Landing site')).toContain('aria-current="step"')
    expect(stepButton(html, 'Mission settings')).toContain('disabled=""')
    expect(stepButton(html, 'Walks')).toContain('disabled=""')
    const set = render({ step: 'landing' })
    expect(stepButton(set, 'Mission settings')).not.toContain('disabled=""')
    expect(stepButton(set, 'Walks')).toContain('disabled=""')
    expect(stepButton(render({ plan: SAMPLE_WALK_PLAN }), 'Walks')).toContain('aria-current="step"')
  })

  it('shows the site once set, says a second click moves it, and lets Next through', () => {
    const html = render({ step: 'landing', picking: true })
    expect(html).toContain('18.440°N 77.450°E')
    expect(html).toContain('Click the map again to move it.')
    expect(html).toMatch(/<button type="button"(?! disabled)[^>]*>Next<\/button>/)
    // The pick's button stays mounted and reads as pressed, so a key press keeps its focus.
    expect(html).toMatch(/<button type="button" aria-pressed="true"[^>]*>Change<\/button>/)
  })

  it('offers Change, or the pick, unpressed once the pick was cancelled', () => {
    expect(render({ step: 'landing' })).toMatch(/aria-pressed="false"[^>]*>Change</)
    expect(render({ step: 'landing', landing: null })).toMatch(/aria-pressed="false"[^>]*>Pick the landing site on the map</)
  })

  it('offers the selected point as the landing site, the way in without a pointer', () => {
    expect(render({ step: 'landing', landing: null, useSelected: true })).toContain('>Use the selected point<')
    expect(render({ step: 'landing', landing: null })).not.toContain('Use the selected point')
  })

  it('does not offer the pick during navigation, and says what to do', () => {
    const html = render({ step: 'landing', canPick: false, useSelected: true })
    expect(html).not.toContain('>Change<')
    expect(html).not.toContain('Use the selected point')
    expect(html).toContain('End navigation to pick the landing site on the globe.')
  })

  it('refuses a site no walk can start from: the reason, Next and the settings step closed', () => {
    const html = render({ step: 'landing', landingProblem: 'fixture: outside the sheet' })
    expect(html).toContain('<p role="alert" class="text-caption text-danger">fixture: outside the sheet</p>')
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Next<\/button>/)
    expect(stepButton(html, 'Mission settings')).toContain('disabled=""')
  })

  it('shows the plan only on the walks step', () => {
    expect(render({ plan: SAMPLE_WALK_PLAN, step: 'settings' })).not.toContain('Stand at the start')
    expect(render({ plan: SAMPLE_WALK_PLAN, step: 'landing' })).not.toContain('Stand at the start')
  })
})

describe('LandingStep rating row', () => {
  const row = (rating?: Classified<LandingReading>) =>
    renderToStaticMarkup(
      <LandingStep landing={LANDING} problem={null} rating={rating} picking={false} onPick={() => {}} onCancelPick={() => {}} onNext={() => {}} />,
    )

  it('leaves the row out when nobody worked a rating out', () => {
    expect(row()).not.toContain('Landing rating')
  })

  it('names the colour and the slope with the method in the mark', () => {
    const html = row(derived({ colour: 'green', slopeDeg: 2.14, cellKm: 0.413 }, 'fixture method'))
    expect(html).toContain('Green')
    expect(html).toContain('2.1°')
    // Its scale, so it never reads as the Point panel's slope over a few tens of metres.
    expect(html).toMatch(/over <span[^>]*>0\.41 km<\/span> cells/)
    expect(html).toContain('fixture method')
  })

  it('says unavailable with the reason, never a colour', () => {
    const html = row(unavailable('fixture: no height here'))
    expect(html).toContain('unavailable')
    expect(html).toContain('fixture: no height here')
    expect(html).not.toMatch(/Green|Yellow|Red/)
  })
})

describe('walk steps', () => {
  const none = { landingReady: false, hasPlan: false }
  const landed = { landingReady: true, hasPlan: false }
  const planned = { landingReady: true, hasPlan: true }
  // The sample walk: a plan with no landing site.
  const planOnly = { landingReady: false, hasPlan: true }

  it('opens the settings with a landing site and the walks with a plan', () => {
    expect(stepOpen('landing', none)).toBe(true)
    expect(stepOpen('settings', none)).toBe(false)
    expect(stepOpen('settings', landed)).toBe(true)
    expect(stepOpen('walks', landed)).toBe(false)
    expect(stepOpen('walks', planOnly)).toBe(true)
  })

  it('falls back to the nearest earlier step that can be opened', () => {
    expect(shownStep('walks', planned)).toBe('walks')
    expect(shownStep('walks', landed)).toBe('settings')
    expect(shownStep('walks', none)).toBe('landing')
    expect(shownStep('settings', none)).toBe('landing')
    expect(shownStep('settings', planOnly)).toBe('landing')
  })

  it('starts on the walks with a plan, else on the landing site', () => {
    expect(firstStep(planOnly)).toBe('walks')
    expect(firstStep(landed)).toBe('landing')
  })
})

describe('Plan a walk, mission settings step', () => {
  it('shows the sliders and Plan walks, with no goal and no word of the settings being ignored', () => {
    const html = render({})
    expect(html.match(/type="range"/g)).toHaveLength(4)
    expect(html).not.toContain('Science goal')
    expect(html).toMatch(/<button type="button"(?! disabled)[^>]*>Plan walks<\/button>/)
    expect(html).not.toContain('not applied')
  })

  it('cites the slope limit only when it is the suited figure; a limit set in the settings has no OFFICIAL mark', () => {
    const cited = render({ plan: SAMPLE_WALK_PLAN })
    expect(cited).toMatch(/Slope limit .*?20°.*?<span class="sr-only">OFFICIAL<\/span>/s)
    const own = { ...SAMPLE_WALK_PLAN, slopeLimit: { deg: 15, label: 'set in the mission settings, not a cited figure', source: 'settings' } }
    const html = render({ plan: own })
    const line = html.slice(html.indexOf('Slope limit '), html.indexOf('Stand at the start'))
    expect(visibleText(line)).toContain('Slope limit 15°')
    expect(methodologyText(line)).toContain('set in the mission settings')
    expect(line).not.toContain('OFFICIAL')
  })

  it('keeps Plan walks off while the settings cannot work', () => {
    const html = render({ settings: { ...DEFAULT_MISSION_SETTINGS, samples: 20, durationMin: 60 } })
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Plan walks<\/button>/)
  })

  it('has no sliders on the other steps', () => {
    expect(render({ step: 'landing' })).not.toContain('type="range"')
    expect(render({ plan: SAMPLE_WALK_PLAN })).not.toContain('type="range"')
  })
})
