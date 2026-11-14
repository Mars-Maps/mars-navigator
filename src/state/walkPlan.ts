import { create } from 'zustand'
import { walkPlanProblem, type WalkPlan } from '../domain'

/**
 * The planned Marswalk and the stop the astronaut is heading for.
 * Its own store, like Measure, so missionStore stays under the 500-line
 * limit. The planner sets the plan; the HUD, the stop
 * card and the surface walk read it and step through stops.
 */
export interface WalkPlanState {
  plan: WalkPlan | null
  /** Index into `plan.stops` of the stop being walked to; 0 with no plan. */
  activeStopIndex: number
  /** Sets the plan and starts at its first stop. A broken plan is refused: the reason comes back and nothing changes. */
  setWalkPlan: (plan: WalkPlan) => string | null
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

export const useWalkPlan = create<WalkPlanState>()((set, get) => ({
  plan: null,
  activeStopIndex: 0,
  setWalkPlan: (plan) => {
    const problem = walkPlanProblem(plan)
    if (problem === null) set({ plan, activeStopIndex: 0 })
    return problem
  },
  // Leaves an empty store alone, so clearing with no plan renders nothing.
  clearWalkPlan: () => set((s) => (s.plan === null ? s : { plan: null, activeStopIndex: 0 })),
  goToStop: (index) => {
    const { plan, activeStopIndex } = get()
    if (!plan) return
    const next = clampStopIndex(index, plan.stops.length)
    if (next !== activeStopIndex) set({ activeStopIndex: next })
  },
  nextStop: () => get().goToStop(get().activeStopIndex + 1),
  previousStop: () => get().goToStop(get().activeStopIndex - 1),
}))
