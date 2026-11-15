import { create } from 'zustand'
import { walkPlanProblem, type WalkPlan } from '../domain'

/** Plan a walk offers this many walks at once: one per kind. */
export const MAX_WALK_PLANS = 3

/**
 * The planned Marswalks and the stop the astronaut is heading for. Its own store, like Measure, so missionStore stays under the
 * 500-line limit. The planner sets up to three plans and one is selected;
 * the HUD, the stop card and the surface walk read the
 * selected one as `plan`, as they did when there was only one.
 */
export interface WalkPlanState {
  /** Every plan offered, in the planner's order; empty with none. */
  plans: readonly WalkPlan[]
  /** Index into `plans` of the selected walk; 0 with none. */
  selectedIndex: number
  /** The selected plan, `plans[selectedIndex]`; null with none. */
  plan: WalkPlan | null
  /** Index into `plan.stops` of the stop being walked to; 0 with no plan. */
  activeStopIndex: number
  /** Sets one plan and starts at its first stop. A broken plan is refused: the reason comes back and nothing changes. */
  setWalkPlan: (plan: WalkPlan) => string | null
  /**
   * Sets one to MAX_WALK_PLANS plans, selects the first and starts at its
   * first stop. Refused, nothing changed, when any plan is broken or the
   * count is wrong; the reason names the walk.
   */
  setWalkPlans: (plans: readonly WalkPlan[]) => string | null
  /** Selects a walk, clamped to the plans, and starts it at its first stop; nothing happens with no plans. */
  selectWalk: (index: number) => void
  clearWalkPlan: () => void
  /** Clamped to the plan's stops; nothing happens with no plan. */
  goToStop: (index: number) => void
  nextStop: () => void
  previousStop: () => void
}

/** `index` kept within a plan of `count` stops. */
export function clampStopIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0
  return Math.min(count - 1, Math.max(0, Math.trunc(index)))
}

/** Why `plans` cannot be set, or null. */
export function walkPlansProblem(plans: readonly WalkPlan[]): string | null {
  if (plans.length < 1 || plans.length > MAX_WALK_PLANS) {
    return `Plan a walk offers 1 to ${MAX_WALK_PLANS} walks, not ${plans.length}`
  }
  for (let i = 0; i < plans.length; i++) {
    const problem = walkPlanProblem(plans[i])
    if (problem !== null) return plans.length === 1 ? problem : `Walk ${i + 1}: ${problem}`
  }
  return null
}

export const useWalkPlan = create<WalkPlanState>()((set, get) => ({
  plans: [],
  selectedIndex: 0,
  plan: null,
  activeStopIndex: 0,
  setWalkPlan: (plan) => get().setWalkPlans([plan]),
  setWalkPlans: (plans) => {
    const problem = walkPlansProblem(plans)
    if (problem === null) set({ plans: [...plans], selectedIndex: 0, plan: plans[0], activeStopIndex: 0 })
    return problem
  },
  selectWalk: (index) => {
    const { plans, selectedIndex } = get()
    if (plans.length === 0) return
    const next = clampStopIndex(index, plans.length)
    if (next !== selectedIndex) set({ selectedIndex: next, plan: plans[next], activeStopIndex: 0 })
  },
  // Leaves an empty store alone, so clearing with no plan renders nothing.
  clearWalkPlan: () =>
    set((s) => (s.plan === null ? s : { plans: [], selectedIndex: 0, plan: null, activeStopIndex: 0 })),
  goToStop: (index) => {
    const { plan, activeStopIndex } = get()
    if (!plan) return
    const next = clampStopIndex(index, plan.stops.length)
    if (next !== activeStopIndex) set({ activeStopIndex: next })
  },
  nextStop: () => get().goToStop(get().activeStopIndex + 1),
  previousStop: () => get().goToStop(get().activeStopIndex - 1),
}))
