import { renderToStaticMarkup } from 'react-dom/server'
import type { WalkOutcome } from '../../src/app/planWalks'
import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { DEFAULT_MISSION_SETTINGS, derived, unavailable, type WalkKind, type WalkPlan } from '../../src/domain'
import { GoalPickerView } from '../../src/features/mission-ui/walk/GoalPicker'
import { WalkCards } from '../../src/features/mission-ui/walk/WalkCards'
import {
  brokenLine,
  cardFigures,
  energyCaveat,
  orderedWalks,
  planIndexOfKind,
  samplesLine,
  uncheckedLine,
  walksOfPlans,
  type PlannedWalk,
  type WalkOption,
} from '../../src/features/mission-ui/walk/walkCardFigures'
import { ENERGY_FIT_CAVEAT, fitsSettings, type WalkBudget } from '../../src/features/route-analysis/walkBudget'

const METHOD = 'fixture budget'
const SETTINGS = DEFAULT_MISSION_SETTINGS // 20°, 6 samples, 600 kcal, 4 h

const planOf = (kind: WalkKind, samples = 5): WalkPlan => ({
  ...SAMPLE_WALK_PLAN,
  kind,
  settings: SETTINGS,
  samples: Array.from({ length: samples }, (_, i) => ({
    id: `${kind}-s${i + 1}`,
    order: i + 1,
    coordinate: SAMPLE_WALK_PLAN.stops[0].coordinate,
    dwellMin: 5,
  })),
})

const budget = (over: Partial<WalkBudget> = {}): WalkBudget => ({
  distanceKm: derived(2.345, METHOD),
  walkingMin: derived(165.4, METHOD),
  samplingMin: derived(25, METHOD),
  totalMin: derived(190.4, METHOD),
  walkingKcal: derived(452.6, METHOD),
  samplingKcal: unavailable('No cited figure for standing at a sample'),
  steepestDeg: derived(12.34, METHOD),
  ...over,
})

// The fit is the walk budget's own verdict on the budget, as the shell makes it.
const planned = (kind: WalkKind, b: WalkBudget, samples = 5, samplesNote: string | null = null): PlannedWalk => ({
  kind,
  status: 'planned',
  plan: planOf(kind, samples),
  budget: b,
  fit: fitsSettings(b, SETTINGS),
  samplesNote,
})

const FLAT = planned('flat-bedrock', budget())
const RIM = planned('rim-to-floor', budget({ totalMin: derived(265, METHOD), steepestDeg: derived(23.2, METHOD) }), 6)
const ROVER: WalkOption = { kind: 'rover-check', status: 'unavailable', reason: 'No rover traverse at this site' }

describe('walk cards: what they show', () => {
  it("takes the shell's WalkOutcome as it is (the view repeats the shape; this fails to compile if they drift)", () => {
    const fromShell: readonly WalkOutcome[] = [FLAT, ROVER]
    const intoView: readonly WalkOption[] = fromShell
    expect(intoView).toHaveLength(2)
  })

  it('puts the walks in the contract order, whatever order they came in', () => {
    expect(orderedWalks([ROVER, RIM, FLAT]).map((w) => w.kind)).toEqual(['flat-bedrock', 'rim-to-floor', 'rover-check'])
  })

  it('finds a kind in the store plans, and says null when it is not there', () => {
    const plans = [RIM.plan, FLAT.plan]
    expect(planIndexOfKind(plans, 'flat-bedrock')).toBe(1)
    expect(planIndexOfKind(plans, 'rover-check')).toBeNull()
  })

  it("keeps the walks only while the store holds every plan they carry (cleared, or the sample walk set, drops them)", () => {
    const walks = [FLAT, RIM, ROVER]
    expect(walksOfPlans(walks, [FLAT.plan, RIM.plan])).toBe(walks)
    expect(walksOfPlans(walks, [])).toEqual([])
    expect(walksOfPlans(walks, [SAMPLE_WALK_PLAN])).toEqual([])
    expect(walksOfPlans(walks, [FLAT.plan])).toEqual([]) // one of them gone
    expect(walksOfPlans(walks, [{ ...FLAT.plan }, RIM.plan])).toEqual([]) // an equal copy is another run's plan
    expect(walksOfPlans([ROVER], [SAMPLE_WALK_PLAN])).toEqual([]) // nothing planned, nothing to show
  })

  it('shows total time and walking energy against the settings, and marks only what the fit says breaks', () => {
    const [distance, time, energy, slope] = cardFigures(RIM)
    expect(distance).toMatchObject({ limit: null, over: false })
    expect(time).toMatchObject({ value: RIM.budget.totalMin, limit: 'of 4 h', over: true })
    expect(energy).toMatchObject({ label: 'Walking energy', value: RIM.budget.walkingKcal, limit: 'of 600 kcal', over: false })
    expect(slope).toMatchObject({ value: RIM.budget.steepestDeg, limit: 'of 20°', over: true })
    expect(time.format(190.4)).toBe('3 h 10 min')
    expect(energy.format(452.6)).toBe('453 kcal')
    expect(slope.format(12.34)).toBe('12.3°')
  })

  it('holds no limit to an unavailable figure', () => {
    const [, , energy] = cardFigures(planned('flat-bedrock', budget({ walkingKcal: unavailable('No height on a leg') })))
    expect(energy.limit).toBeNull()
  })

  it('shows no limit for a plan without settings', () => {
    const { settings: _, ...plan } = FLAT.plan
    expect(cardFigures({ ...FLAT, plan }).every((f) => f.limit === null)).toBe(true)
  })

  it('counts samples against the setting, and says nothing for a walk without samples', () => {
    expect(samplesLine(FLAT.plan)).toBe('5 of 6 samples')
    expect(samplesLine(SAMPLE_WALK_PLAN)).toBeNull()
  })

  it('names each limit the fit breaks, by how much in its unit, and is null when none breaks', () => {
    expect(brokenLine(RIM.fit)).toBe('Over: time by 25 min, slope by 3.2°')
    expect(brokenLine(planned('flat-bedrock', budget({ walkingKcal: derived(640.2, METHOD) })).fit)).toBe('Over: energy by 40 kcal')
    expect(brokenLine(FLAT.fit)).toBeNull()
  })

  it('says which limits could not be checked', () => {
    const gap = planned('flat-bedrock', budget({ walkingKcal: unavailable('No height on a leg') }))
    expect(uncheckedLine(gap.fit)).toBe('Not checked: energy (its figure is unavailable)')
    expect(uncheckedLine(FLAT.fit)).toBeNull()
  })

  it('carries the energy caveat of the fit, and none with no walk planned', () => {
    expect(energyCaveat([ROVER, FLAT])).toBe(ENERGY_FIT_CAVEAT)
    expect(energyCaveat([ROVER])).toBeNull()
  })
})

// The <input> of one walk, whatever order React writes its attributes in.
const inputOf = (html: string, kind: WalkKind) => html.match(new RegExp(`<input[^>]*value="${kind}"[^>]*/>`))?.[0] ?? ''

describe('walk cards: markup', () => {
  const html = renderToStaticMarkup(
    <WalkCards walks={[ROVER, FLAT, planned('rim-to-floor', RIM.budget, 4, 'Only 4 samples fit')]} selectedKind="rim-to-floor" onSelect={() => {}} />,
  )

  it('is one radio group with the selected walk checked', () => {
    expect(html.match(/type="radio"/g)).toHaveLength(3)
    expect(new Set([...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1])).size).toBe(1)
    expect(inputOf(html, 'rim-to-floor')).toContain('checked=""')
    expect(inputOf(html, 'flat-bedrock')).not.toContain('checked=""')
  })

  it('labels each radio with the walk’s name and purpose only: no mark, no figure, no Tab stop inside a label', () => {
    const labels = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1])
    expect(labels).toHaveLength(3)
    for (const label of labels) {
      expect(label).not.toContain('tabindex')
      expect(label).not.toMatch(/<dl|<dt|<div/)
      expect(label).not.toMatch(/OFFICIAL|DERIVED|UNAVAILABLE/)
    }
    // The marks are still in the card, each its own Tab stop beside the radio.
    expect(html).toContain('tabindex="0"')
  })

  it('keeps a walk that could not be planned, disabled, with its reason, never a zero', () => {
    expect(inputOf(html, 'rover-check')).toContain('disabled=""')
    expect(html).toContain('No rover traverse at this site')
    expect(html).toContain('UNAVAILABLE')
  })

  it('shows the figures with their marks, the samples note, the breaks and the energy caveat', () => {
    expect(html).toContain('2.35 km')
    expect(html).toContain('DERIVED')
    expect(html).toContain('Only 4 samples fit')
    expect(html).toContain('Over: time by 25 min, slope by 3.2°')
    expect(html).toContain(ENERGY_FIT_CAVEAT)
  })

  it('shows an UNAVAILABLE figure as unavailable, never as zero', () => {
    const gap = renderToStaticMarkup(
      <WalkCards walks={[planned('flat-bedrock', budget({ walkingKcal: unavailable('No height on a leg') }))]} selectedKind={null} onSelect={() => {}} />,
    )
    expect(gap).toContain('unavailable')
    expect(gap).toContain('Not checked: energy')
    expect(gap).not.toMatch(/>0 kcal</)
  })
})

describe('GoalPickerView step 3 with the walks', () => {
  const render = (walks?: readonly WalkOption[]) =>
    renderToStaticMarkup(
      <GoalPickerView
        step="walks"
        onStep={() => {}}
        landing={SAMPLE_WALK_PLAN.stops[0].coordinate}
        landingProblem={null}
        picking={false}
        settings={SETTINGS}
        onSettings={() => {}}
        onCancelPick={() => {}}
        plan={FLAT.plan}
        walks={walks}
        onSelectWalk={() => {}}
        status={{ kind: 'idle' }}
        onPlan={() => {}}
        canStand
        onStand={() => {}}
      />,
    )

  it('shows the cards above the selected plan', () => {
    const html = render([FLAT, RIM, ROVER])
    expect(html).toContain('Rim to floor')
    expect(html.indexOf('<legend')).toBeLessThan(html.indexOf('Stand at the start'))
  })

  it('shows the one plan as before when the shell sends no walks', () => {
    const html = render()
    expect(html).not.toContain('Rim to floor')
    expect(html).toContain('Stand at the start')
  })
})
