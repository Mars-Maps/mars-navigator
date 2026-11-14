import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { wantsSampleWalk } from '../../src/app/sampleWalk'
import { SampleWalkBanner } from '../../src/app/SampleWalkBanner'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import { walkPlanProblem, type Classified } from '../../src/domain'
import { useWalkPlan } from '../../src/state'

describe('the sample walk plan', () => {
  it('keeps the walk-plan contract, so the store takes it, and Clear removes it', () => {
    expect(walkPlanProblem(SAMPLE_WALK_PLAN)).toBeNull()
    expect(useWalkPlan.getState().setWalkPlan(SAMPLE_WALK_PLAN)).toBeNull()
    expect(useWalkPlan.getState().plan).toBe(SAMPLE_WALK_PLAN)
    useWalkPlan.getState().clearWalkPlan()
    expect(useWalkPlan.getState().plan).toBeNull()
  })

  it('claims nothing: every value is SIMULATED or UNAVAILABLE, never OFFICIAL or DERIVED', () => {
    const { goal, stops, legs } = SAMPLE_WALK_PLAN
    const values: Classified<unknown>[] = [
      goal.reason,
      ...stops.flatMap((s) => [s.unit, s.reason]),
      ...legs.flatMap((l) => [l.path, l.distanceKm, l.steepestSlopeDeg, l.hazards]),
    ]
    for (const v of values) expect(['SIMULATED', 'UNAVAILABLE']).toContain(v.classification)
    // No stop pretends to know its geologic unit.
    for (const s of stops) expect(s.unit.classification).toBe('UNAVAILABLE')
    expect(goal.label).toMatch(/simulated/i)
  })

  it('has legs whose distances match their straight lines, a few hundred metres each', () => {
    for (const leg of SAMPLE_WALK_PLAN.legs) {
      expect(leg.distanceKm.classification).toBe('SIMULATED')
      if (leg.distanceKm.classification === 'SIMULATED') {
        expect(leg.distanceKm.value).toBeGreaterThan(0.2)
        expect(leg.distanceKm.value).toBeLessThan(1)
      }
    }
  })
})

describe('?sampleWalk', () => {
  it('is asked for only by the parameter', () => {
    expect(wantsSampleWalk('?sampleWalk')).toBe(true)
    expect(wantsSampleWalk('?perf&sampleWalk=1')).toBe(true)
    expect(wantsSampleWalk('')).toBe(false)
    expect(wantsSampleWalk('?sample')).toBe(false)
  })

  it('shows a SIMULATED banner only while the sample is the plan', () => {
    const shown = renderToStaticMarkup(<SampleWalkBanner active text="Sample walk: stops picked by hand. Not a plan." onClear={() => {}} />)
    expect(shown).toMatch(/SIMULATED/)
    expect(shown).toMatch(/Not a plan/)
    expect(renderToStaticMarkup(<SampleWalkBanner active={false} text="x" onClear={() => {}} />)).toBe('')
  })
})
