import { useEffect, useRef, useState } from 'react'
import type { MarsCoordinate, ScienceGoal } from '../domain'
import { GoalPickerView, type PlanStatus } from '../features/mission-ui/walk/GoalPicker'
import { walkStart } from '../features/mission-ui/walk/walkStart'
import { canTransition, useMissionStore, useRoutePick, useWalkPlan } from '../state'
import { geologicFeatures, geologicUnitAreas, geologicUnitAt } from '../data/adapters/GeologyAdapter'
import { DEFAULT_SITE } from '../data/sites/sites'
import { profileHeights } from './elevation'
import { holdWelcomeReturn } from './viewModeTriggers'
import { readRoverTraverse } from './roverFeed'
import { createWalkPlanner, planStatusAt, planWalk, standAtWalkStart, walkHeights } from './walkPlanner'

const WALK_PLANNER = createWalkPlanner({
  site: DEFAULT_SITE.site,
  units: (bounds, signal) => geologicUnitAreas(bounds, signal),
  unitAt: (point, signal) => geologicUnitAt(point, signal),
  features: (bounds, signal) => geologicFeatures(bounds, signal),
  heights: walkHeights((points, signal) => profileHeights.elevationsAt(points, signal)),
  cellKmAlong: (path) => profileHeights.cellKmAlong(path),
  traverse: (signal) => readRoverTraverse('perseverance', signal),
})

/**
 * The Plan a walk tool with its planner: the view picks the goal;
 * the shell plans from the walk's start and puts the plan in the walk-plan
 * store. Moving the start or closing the panel cancels a plan still running,
 * so an answer for an old start never lands.
 */
export function WalkPlannerPanel() {
  const departure = useMissionStore((s) => s.routeDraft.departure)
  const selected = useMissionStore((s) => s.selectedPoint)
  const plan = useWalkPlan((s) => s.plan)
  const canStand = useMissionStore((s) => canTransition(s.viewMode, 'surface'))
  // A pick needs the globe and the editable search bar, which shows its notice and takes its Escape.
  const canPick = useMissionStore((s) => s.viewMode !== 'surface' && s.viewMode !== 'navigation')
  // Planning keeps the start it was for: a reason about one start does not apply to the next.
  const [status, setStatus] = useState<{ status: PlanStatus; at: MarsCoordinate | null }>({
    status: { kind: 'idle' },
    at: null,
  })
  const running = useRef<AbortController | null>(null)
  const start = walkStart(departure, selected)

  const startAt = start?.coordinate ?? null
  useEffect(() => () => running.current?.abort(), [startAt])
  const shown = planStatusAt(status, startAt)

  const onPlan = (goal: ScienceGoal) => {
    if (!start) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    const at = start.coordinate
    setStatus({ status: { kind: 'planning' }, at })
    // Waiting on the planner is not idle: no welcome screen over it.
    const release = holdWelcomeReturn()
    void planWalk(WALK_PLANNER, goal, start.coordinate, controller.signal)
      .then((result) => {
        if (running.current !== controller) return // a newer plan owns the status
        if (result.status === 'aborted' || controller.signal.aborted) return setStatus({ status: { kind: 'idle' }, at: null })
        if (result.status === 'failed') return setStatus({ status: { kind: 'failed', reason: result.reason }, at })
        const refused = useWalkPlan.getState().setWalkPlan(result.plan)
        setStatus({ status: refused ? { kind: 'failed', reason: refused } : { kind: 'idle' }, at })
      })
      .finally(release)
  }

  return (
    <GoalPickerView
      goals={WALK_PLANNER.goals}
      start={start}
      plan={plan}
      status={shown}
      onPlan={onPlan}
      canStand={canStand}
      onStand={standAtWalkStart}
      onPickStart={canPick ? () => useRoutePick.getState().startRoutePick('departure') : undefined}
    />
  )
}
