import { useEffect } from 'react'
import { SAMPLE_WALK_PLAN } from '../data/mock/sampleWalkPlan'
import { useWalkPlan } from '../state'

/** Whether the page asked for the sample walk plan: `?sampleWalk` in its address. */
export function wantsSampleWalk(search: string): boolean {
  return new URLSearchParams(search).has('sampleWalk')
}

/**
 * Puts the SIMULATED sample walk plan in the store when the address asks for
 * it, once, so the walk views can be tried on chosen stops.
 * Returns whether the plan on show is the sample, for the banner.
 */
export function useSampleWalkPlan(): boolean {
  useEffect(() => {
    if (!wantsSampleWalk(window.location.search)) return
    const problem = useWalkPlan.getState().setWalkPlan(SAMPLE_WALK_PLAN)
    if (problem) console.warn(`The sample walk plan was refused: ${problem}`)
  }, [])
  return useWalkPlan((s) => s.plan === SAMPLE_WALK_PLAN)
}
