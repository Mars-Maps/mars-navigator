import { useState } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import { formatMarsCoordinate, type ScienceGoal, type WalkLeg, type WalkPlan } from '../../../domain'
import { ClassifiedValue } from '../ClassifiedValue'
import { LegDetail } from './LegDetail'
import { WalkPlanMap } from './WalkPlanMap'
import type { WalkStart } from './walkStart'

/** Where the shell's planning is: nothing asked yet, working, or why it could not plan. */
export type PlanStatus = { kind: 'idle' } | { kind: 'planning' } | { kind: 'failed'; reason: string }

/**
 * The Plan a walk tool's panel: pick a science goal, plan from the
 * walk's start, and see the plan's stops and legs. Renders from props. The
 * shell runs the planner and puts the plan in the walk-plan store, which the
 * HUD, the stop card and the surface walk read; the figures shown here,
 * each leg's slope and flags included (`LegDetail`), are the plan's own,
 * never worked out again.
 */
export function GoalPickerView({
  goals,
  start,
  plan,
  status,
  onPlan,
  canStand,
  onStand,
  onPickStart,
}: {
  goals: readonly ScienceGoal[]
  start: WalkStart | null
  /** The plan in the store, from this panel or any other source. */
  plan: WalkPlan | null
  status: PlanStatus
  onPlan: (goal: ScienceGoal) => void
  /** False where the surface view cannot be entered from here (navigation). */
  canStand: boolean
  /** Stand on the ground at the plan's first stop. */
  onStand: () => void
  /** Picks the departure on the globe, offered while there is no start. */
  onPickStart?: () => void
}) {
  // The plan's goal when it is one of these; a plan from elsewhere (the sample walk) starts at the first.
  const [goalId, setGoalId] = useState(() =>
    plan && goals.some((g) => g.id === plan.goal.id) ? plan.goal.id : (goals[0]?.id ?? ''),
  )
  const goal = goals.find((g) => g.id === goalId) ?? null
  const { minimized, toggle, bodyId } = useMinimized()
  const planning = status.kind === 'planning'
  const blocked =
    start === null ? 'Pick a departure on the globe, set one in the search bar, or a point from the right-click menu.' : null

  // No ×: the dock's button closes a tool's panel.
  return (
    <Panel surface="glass" compact={minimized} className="max-h-[calc(100vh-10rem)] w-full overflow-y-auto">
      <PanelHeader title="Plan a walk" minimized={minimized} onToggleMinimized={toggle} bodyId={bodyId} spacing="mb-3">
        <h2 className="text-heading font-semibold text-ink">Plan a walk</h2>
      </PanelHeader>
      {minimized ? null : (
        <div id={bodyId} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-caption text-ink-subtle">Science goal</legend>
            {goals.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-body text-ink">
                <input
                  type="radio"
                  name="walk-goal"
                  value={g.id}
                  checked={g.id === goalId}
                  onChange={() => setGoalId(g.id)}
                />
                <span>{g.label}</span>
                <ClassificationBadge classification={g.reason.classification} detail={detailOf(g)} />
              </label>
            ))}
          </fieldset>
          <p className="text-caption text-ink-muted">
            {start ? (
              <>
                Starts at your {start.from}:{' '}
                <span className="tabular-nums text-ink">{formatMarsCoordinate(start.coordinate, 3)}</span>
              </>
            ) : (
              blocked
            )}
          </p>
          {start === null && onPickStart && (
            <button
              type="button"
              onClick={onPickStart}
              className="self-start rounded-control bg-accent/15 px-3 py-1 text-body text-accent transition-colors duration-(--duration-fast) hover:bg-accent/25"
            >
              Pick the departure on the globe
            </button>
          )}
          <button
            type="button"
            disabled={goal === null || start === null || planning}
            onClick={() => goal && onPlan(goal)}
            className="self-start rounded-control border border-line px-3 py-1 text-body text-ink transition-colors duration-(--duration-fast) hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-ink-subtle/60"
          >
            {planning ? 'Planning…' : 'Plan'}
          </button>
          {/* Mounted before it has words, so a screen reader announces them. */}
          <p role="status" className={planning ? 'text-caption text-ink-muted' : 'sr-only'}>
            {planning && 'Reading the map and the elevation models. Where the 1 m model answers, this can take about 20 s.'}
          </p>
          {status.kind === 'failed' && (
            <p role="alert" className="text-caption text-danger">
              Could not plan: {status.reason}
              {plan && <span className="block">The plan below is the previous one.</span>}
            </p>
          )}
          {plan && <PlanSummary plan={plan} canStand={canStand} onStand={onStand} />}
        </div>
      )}
    </Panel>
  )
}

/** The plan in the store: its goal, each stop with the leg that reaches it, and the way onto the ground. */
function PlanSummary({ plan, canStand, onStand }: { plan: WalkPlan; canStand: boolean; onStand: () => void }) {
  return (
    <section aria-label="Planned walk" className="flex flex-col gap-1.5 border-t border-line/60 pt-3">
      <p className="flex items-center gap-1.5 text-caption text-ink-subtle">
        <span>
          {/* The start is not a numbered stop: "the start and 3 stops" for Start, Stop 1–3. */}
          Planned: <span className="text-ink">{plan.goal.label}</span>, the start and{' '}
          {plan.stops.length - 1 === 1 ? '1 stop' : `${plan.stops.length - 1} stops`}
        </span>
        <ClassificationBadge classification={plan.goal.reason.classification} detail={detailOf(plan.goal)} />
      </p>
      <p className="text-caption text-ink-muted">
        From <span className="tabular-nums text-ink">{formatMarsCoordinate(plan.stops[0].coordinate, 3)}</span>
      </p>
      <WalkPlanMap plan={plan} />
      <p className="flex items-start gap-1.5 text-caption text-ink-muted">
        <span>
          Slope limit {plan.slopeLimit.deg}°: {plan.slopeLimit.label}
        </span>
        <ClassificationBadge classification="OFFICIAL" detail={plan.slopeLimit.source} />
      </p>
      <p className="text-caption text-ink-muted">
        Slopes are measured over a few metres to 100 m or more, depending on the elevation model and the leg&rsquo;s length, so a flag means look here, not impassable.
      </p>
      <p className="text-caption text-ink-muted">
        Each leg is a straight line between its stops. It flags steep ground and mapped obstacles on the way; it does not go around them.
      </p>
      {/* The plan's next step, so the panel's highlighted button, as End
          navigation is: across the panel, accent, a little taller than the text
          around it. Disabled, it falls back to the plain outline. */}
      <button
        type="button"
        disabled={!canStand}
        onClick={onStand}
        className="w-full rounded-control border border-accent/50 bg-accent/15 px-3 py-2 text-body font-medium text-accent transition-colors duration-(--duration-fast) hover:border-accent/80 hover:bg-accent/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:font-normal disabled:text-ink-subtle/60"
      >
        Stand at the start
      </button>
      {!canStand && <p className="text-caption text-ink-muted">End navigation to stand on the ground.</p>}
      <ol className="flex flex-col gap-2">
        {plan.stops.map((stop, i) => {
          const leg = i > 0 ? plan.legs[i - 1] : null
          return (
            <li key={stop.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3 text-body">
                <span className="min-w-0 truncate text-ink">{stop.label}</span>
                {leg && <ClassifiedValue value={leg.distanceKm} format={(km) => `${km.toFixed(2)} km`} />}
              </div>
              {leg && <LegDetail leg={leg} limitDeg={plan.slopeLimit.deg} />}
              {leg?.path.classification === 'UNAVAILABLE' && (
                <p className="text-caption text-ink-muted">Leg not drawn{pathReasonIfNew(leg)}</p>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** ": why", unless the leg's distance already gives the same reason in its mark. */
function pathReasonIfNew({ path, distanceKm }: WalkLeg): string {
  if (path.classification !== 'UNAVAILABLE') return ''
  return distanceKm.classification === 'UNAVAILABLE' && distanceKm.reason === path.reason ? '' : `: ${path.reason}`
}

function detailOf(goal: ScienceGoal): string {
  const r = goal.reason
  if (r.classification === 'UNAVAILABLE') return r.reason
  return `${r.value}. ${r.classification === 'DERIVED' ? r.method : r.source}`
}
