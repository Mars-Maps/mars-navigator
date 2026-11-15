import { useEffect, useRef, useState } from 'react'
import { ClassificationBadge } from '../../../components/ClassificationBadge'
import { Panel } from '../../../components/Panel'
import { PanelHeader } from '../../../components/PanelHeader'
import { useMinimized } from '../../../components/useMinimized'
import {
  formatMarsCoordinate,
  type Classified,
  type MarsCoordinate,
  type ScienceGoal,
  type WalkKind,
  type WalkLeg,
  type WalkPlan,
} from '../../../domain'
import { ClassifiedValue } from '../ClassifiedValue'
import { LandingLegendLine, type LandingColoursStatus } from './LandingLegend'
import { LandingStep, type LandingReading } from './LandingStep'
import { isCitedSlopeLimit } from '../slopeLimit'
import { LegDetail } from './LegDetail'
import { MissionSettingsStep } from './MissionSettingsStep'
import { settingsValid, type MissionSettings } from './missionSettings'
import { WalkCards } from './WalkCards'
import type { WalkOption } from './walkCardFigures'
import { WalkPlanMap } from './WalkPlanMap'
import { WALK_STEPS, minimisedLegendMethod, stepOpen, type WalkStep } from './walkSteps'

/**
 * Step 3 is the tall one (three cards, the map, every leg) and is read
 * beside the walk drawn on the globe, so it moves out of the middle: to the
 * right, 5 rem from the edge (clear of the icon column), and up over the
 * walker widget in that corner. The dock's slot is 24 rem wide and centred,
 * so the shift is half the window less half the panel and the gap; never to
 * the left on a narrow window. Shorter by the lift, so its top stays under the time bar.
 */
const WALKS_AT_THE_RIGHT = 'max-h-[calc(100vh-15rem)] translate-x-[max(0px,calc(50vw-17rem))] -translate-y-16'

/** Where the shell's planning is: nothing asked yet, working, or why it could not plan. */
export type PlanStatus = { kind: 'idle' } | { kind: 'planning' } | { kind: 'failed'; reason: string }

/**
 * The Plan a walk tool's panel, in three steps: the landing site, set
 * by a click on the map; the mission settings, where the walk is planned;
 * and the planned walk with its stops and legs. Renders from props.
 * The shell holds the step, runs the pick and the planner, and puts the plan
 * in the walk-plan store, which the HUD, the stop card and the surface walk
 * read; the figures shown here, each leg's slope and flags included
 * (`LegDetail`), are the plan's own, never worked out again.
 *
 * The second step holds the mission settings: four sliders and Plan
 * walks, which plans the three scientific walks within them.
 */
export function GoalPickerView({
  step,
  onStep,
  landing,
  landingProblem,
  landingRating,
  landingColours,
  picking,
  onPickLanding,
  settings,
  onSettings,
  onCancelPick,
  onUseSelected,
  plan,
  walks,
  onSelectWalk,
  status,
  onPlan,
  canStand,
  onStand,
}: {
  /** The step on show; the shell keeps it to one that can be opened (`shownStep`). */
  step: WalkStep
  onStep: (step: WalkStep) => void
  landing: MarsCoordinate | null
  /** Why no walk can start from the landing site, or null. */
  landingProblem: string | null
  landingRating?: Classified<LandingReading>
  /** The landing colours drawn on the map while the first step is open, for their legend. */
  landingColours?: LandingColoursStatus
  /** The next click on the map sets the landing site. */
  picking: boolean
  /** Turns the pick on; absent where the globe cannot be clicked. */
  onPickLanding?: () => void
  onCancelPick: () => void
  /** Lands at the selected point; absent with no other point selected. */
  onUseSelected?: () => void
  /** The plan in the store, from this panel or any other source. */
  plan: WalkPlan | null
  /**
   * The three walks, planned or not, for step 3's cards. Absent until the
   * shell plans them: step 3 then shows the one plan in the store.
   */
  walks?: readonly WalkOption[]
  /** Selects the walk of that kind in the store; needed with `walks`. */
  onSelectWalk?: (kind: WalkKind) => void
  status: PlanStatus
  settings: MissionSettings
  onSettings: (settings: MissionSettings) => void
  onPlan: (settings: MissionSettings) => void
  /** False where the surface view cannot be entered from here (navigation). */
  canStand: boolean
  /** Stand on the ground at the plan's first stop. */
  onStand: () => void
}) {
  const { minimized: chosen, toggle, bodyId } = useMinimized()
  // While the landing pick waits for its first click, the panel folds to its
  // legend line: the colours under it show, and a click on them reaches the
  // map, not the panel. It opens again once a site is set; its + opens
  // it at once.
  const [opened, setOpened] = useState(false)
  const autoFolded = step === 'landing' && picking && landing === null && !opened
  const minimized = chosen || autoFolded
  const onToggle = autoFolded && !chosen ? () => setOpened(true) : toggle
  const legendMethod = minimisedLegendMethod(minimized, step, landingColours)
  const planning = status.kind === 'planning'
  const progress = { landingReady: landing !== null && landingProblem === null, hasPlan: plan !== null }
  // A step change unmounts the button that asked for it (Next, Plan), so
  // focus goes to the new step's own button rather than back to the page.
  const currentStep = useRef<HTMLButtonElement>(null)
  const stepShown = useRef(step)
  useEffect(() => {
    if (stepShown.current === step) return
    stepShown.current = step
    currentStep.current?.focus()
  }, [step])

  // No ×: the dock's button closes a tool's panel.
  return (
    <Panel
      surface="glass"
      compact={minimized}
      className={`w-full overflow-y-auto ${step === 'walks' && !minimized ? WALKS_AT_THE_RIGHT : 'max-h-[calc(100vh-10rem)]'}`}
    >
      <PanelHeader title="Plan a walk" minimized={minimized} onToggleMinimized={onToggle} bodyId={bodyId} spacing="mb-3">
        <h2 className="text-heading font-semibold text-ink">Plan a walk</h2>
      </PanelHeader>
      {/* The colours stay on the map while the panel is minimised, so what they are stays on show too. */}
      {legendMethod !== null && <LandingLegendLine method={legendMethod} />}
      {minimized ? null : (
        <div id={bodyId} className="flex flex-col gap-3">
          <nav aria-label="Steps of planning a walk">
            <ol className="flex gap-1">
              {WALK_STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!stepOpen(s.id, progress)}
                    ref={s.id === step ? currentStep : undefined}
                    aria-current={s.id === step ? 'step' : undefined}
                    onClick={() => onStep(s.id)}
                    className={`rounded-control px-2 py-1 whitespace-nowrap text-caption transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:text-ink-subtle/60 ${
                      s.id === step ? 'bg-accent/15 text-accent' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                    }`}
                  >
                    {i + 1}. {s.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          {step === 'landing' && (
            <LandingStep
              landing={landing}
              problem={landingProblem}
              rating={landingRating}
              colours={landingColours}
              picking={picking}
              onPick={onPickLanding}
              onCancelPick={onCancelPick}
              onUseSelected={onUseSelected}
              onNext={() => onStep('settings')}
            />
          )}
          {step === 'settings' && (
            <>
              <p className="text-caption text-ink-muted">
                Lands at{' '}
                <span className="tabular-nums text-ink">{landing ? formatMarsCoordinate(landing, 3) : 'no landing site'}</span>
              </p>
              <MissionSettingsStep settings={settings} onChange={onSettings} />
              <button
                type="button"
                disabled={!progress.landingReady || planning || !settingsValid(settings)}
                onClick={() => onPlan(settings)}
                className="w-full rounded-control border border-accent/50 bg-accent/15 px-3 py-2 text-body font-medium text-accent transition-colors duration-(--duration-fast) hover:border-accent/80 hover:bg-accent/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:font-normal disabled:text-ink-subtle/60"
              >
                {planning ? 'Planning…' : 'Plan walks'}
              </button>
            </>
          )}
          {/* Mounted on every step and before it has words, so a screen reader announces them. */}
          <p role="status" className={planning ? 'text-caption text-ink-muted' : 'sr-only'}>
            {planning && 'Planning three walks: reading the map, the rover’s path and the elevation models. This can take about half a minute.'}
          </p>
          {status.kind === 'failed' && (
            <p role="alert" className="text-caption text-danger">
              Could not plan: {status.reason}
              {plan && <span className="block">The plan under Walks is the previous one.</span>}
            </p>
          )}
          {step === 'walks' && walks && walks.length > 0 && onSelectWalk && (
            <WalkCards walks={walks} selectedKind={plan?.kind ?? null} onSelect={onSelectWalk} />
          )}
          {step === 'walks' && plan && <PlanSummary plan={plan} canStand={canStand} onStand={onStand} />}
        </div>
      )}
    </Panel>
  )
}

/** The plan in the store: its goal, each stop with the leg that reaches it, and the way onto the ground. */
function PlanSummary({ plan, canStand, onStand }: { plan: WalkPlan; canStand: boolean; onStand: () => void }) {
  return (
    <section aria-label="Planned walk" className="flex flex-col gap-1.5">
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
        {/* Cited only at the suited figure; another value is the settings' own. */}
        {isCitedSlopeLimit(plan.slopeLimit) && (
          <ClassificationBadge classification="OFFICIAL" detail={plan.slopeLimit.source} />
        )}
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
