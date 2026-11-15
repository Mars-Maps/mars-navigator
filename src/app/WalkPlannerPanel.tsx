import { useEffect, useRef, useState } from 'react'
import { unavailable, type MarsCoordinate, type MissionSettings } from '../domain'
import { GoalPickerView, type PlanStatus } from '../features/mission-ui/walk/GoalPicker'
import { DEFAULT_MISSION_SETTINGS } from '../features/mission-ui/walk/missionSettings'
import { planIndexOfKind, walksOfPlans } from '../features/mission-ui/walk/walkCardFigures'
import { firstStep, shownStep } from '../features/mission-ui/walk/walkSteps'
import { canTransition, useLandingSite, useMissionStore, useRoutePick, useSite, useWalkPlan } from '../state'
import { geologicFeatures, geologicUnitAreas, geologicUnitAt } from '../data/adapters/GeologyAdapter'
import { loadPlaceNames } from '../data/adapters/PlaceNamesAdapter'
import { DEFAULT_SITE } from '../data/sites/sites'
import { profileHeights } from './elevation'
import { useLandingRating } from './landingColours'
import { landingRatingAt } from './landingRatingAt'
import { holdWelcomeReturn } from './viewModeTriggers'
import { readRoverTraverse } from './roverFeed'
import { noWalkReason, plannedWalks, planWalks, type WalkOutcome, type WalksPlanner } from './planWalks'
import { sampleProfile } from './routeProfile'
import { craterFromNames, walkDrafts } from './walkDrafts'
import { createWalkPlanner, landingSiteProblem, planStatusAt, standAtWalkStart, walkHeights } from './walkPlanner'

const WALK_PLANNER = createWalkPlanner({
  site: DEFAULT_SITE.site,
  units: (bounds, signal) => geologicUnitAreas(bounds, signal),
  unitAt: (point, signal) => geologicUnitAt(point, signal),
  features: (bounds, signal) => geologicFeatures(bounds, signal),
  heights: walkHeights((points, signal) => profileHeights.elevationsAt(points, signal)),
  cellKmAlong: (path) => profileHeights.cellKmAlong(path),
  traverse: (signal) => readRoverTraverse('perseverance', signal),
})

const profile: WalksPlanner['profile'] = (path, signal) => sampleProfile(path, profileHeights, signal)

/** The Gazetteer's name of the site's crater, for the transect's own rim. */
const SITE_CRATER = 'Jezero'

const WALKS_PLANNER: WalksPlanner = {
  drafts: walkDrafts(WALK_PLANNER, {
    site: DEFAULT_SITE.site,
    units: (bounds, signal) => geologicUnitAreas(bounds, signal),
    unitAt: (point, signal) => geologicUnitAt(point, signal),
    traverse: (signal) => readRoverTraverse('perseverance', signal),
    profile,
    crater: async () => {
      const names = await loadPlaceNames()
      if (names.classification === 'UNAVAILABLE') return names
      // The place names are OFFICIAL, from the Gazetteer; anything else is not a citation for a crater.
      if (names.classification !== 'OFFICIAL') return unavailable('The place names are not the Gazetteer’s own')
      return craterFromNames(names.value, SITE_CRATER, names.source)
    },
  }),
  walkLegs: WALK_PLANNER.walkLegs,
  profile,
}

// The last run's outcomes and the settings, kept for the page's life: the
// tool dock unmounts this panel whenever another tool opens, the tools are
// hidden or the walker stands on the surface, and the walk-plan store keeps
// the plans meanwhile. `walksOfPlans` drops the outcomes once the store no
// longer holds their plans, so a kept run never describes other walks.
const kept: { outcomes: readonly WalkOutcome[]; settings: MissionSettings } = {
  outcomes: [],
  settings: DEFAULT_MISSION_SETTINGS,
}

/**
 * The Plan a walk tool with its planner: the landing site
 * is picked on the map, the settings are set, and the shell plans the three
 * scientific walks from the landing site and puts those it could plan in the
 * walk-plan store; the rest keep their reasons here, for step 3. Moving the landing
 * site or closing the panel cancels a plan still running, so an answer for
 * an old site never lands.
 */
export function WalkPlannerPanel() {
  const landing = useLandingSite((s) => s.landingSite)
  const plan = useWalkPlan((s) => s.plan)
  const plans = useWalkPlan((s) => s.plans)
  const canStand = useMissionStore((s) => canTransition(s.viewMode, 'surface'))
  // A pick needs the editable search bar, which shows its notice and takes its Escape: not in navigation.
  const canPick = useMissionStore((s) => s.viewMode !== 'surface' && s.viewMode !== 'navigation')
  const selected = useMissionStore((s) => s.selectedPoint)
  const picking = useRoutePick((s) => s.slot === 'landing-site')
  // Planning keeps the landing site it was for: a reason about one site does not apply to the next.
  const [status, setStatus] = useState<{ status: PlanStatus; at: MarsCoordinate | null }>({
    status: { kind: 'idle' },
    at: null,
  })
  const running = useRef<AbortController | null>(null)
  // Every walk of the last run, planned or not, for step 3's cards.
  const [outcomes, setOutcomesState] = useState(() => kept.outcomes)
  const [settings, setSettingsState] = useState(() => kept.settings)
  const setOutcomes = (next: readonly WalkOutcome[]) => {
    kept.outcomes = next
    setOutcomesState(next)
  }
  const setSettings = (next: MissionSettings) => {
    kept.settings = next
    setSettingsState(next)
  }

  const landingProblem = landing ? landingSiteProblem(landing, DEFAULT_SITE.site) : null
  const progress = { landingReady: landing !== null && landingProblem === null, hasPlan: plan !== null }
  const [wanted, setWanted] = useState(() => firstStep(progress))
  const step = shownStep(wanted, progress)

  // The landing colours are on the map for as long as the first step is open.
  const rating = useLandingRating(step === 'landing')

  // While the landing step is open, every click on the map sets the site, so
  // a second click moves it. Escape ends the pick; the step's button starts
  // it again. Another pick (a route field), running already or started
  // meanwhile, is left alone.
  useEffect(() => {
    if (step !== 'landing' || !canPick) return
    if (useRoutePick.getState().slot === null) useRoutePick.getState().startRoutePick('landing-site')
    return () => {
      if (useRoutePick.getState().slot === 'landing-site') useRoutePick.getState().cancelRoutePick()
    }
  }, [step, canPick])

  useEffect(() => () => running.current?.abort(), [landing])
  const shown = planStatusAt(status, landing)

  const onPlan = (wanted: MissionSettings) => {
    if (!landing) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    const at = landing
    setStatus({ status: { kind: 'planning' }, at })
    // A run's outcomes belong to its landing site and settings, so the cards
    // go while it plans. The kept ones stay until the new plans are stored:
    // a run cancelled by closing the panel leaves the old plans in the store,
    // and their cards come back with the panel.
    setOutcomesState([])
    // Waiting on the planner is not idle: no welcome screen over it.
    const release = holdWelcomeReturn()
    void planWalks(WALKS_PLANNER, at, wanted, controller.signal)
      .then((result) => {
        if (running.current !== controller) return // a newer plan owns the status
        if (result === 'aborted' || controller.signal.aborted) return setStatus({ status: { kind: 'idle' }, at: null })
        const planned = plannedWalks(result)
        if (planned.length === 0) return setStatus({ status: { kind: 'failed', reason: noWalkReason(result) }, at })
        const refused = useWalkPlan.getState().setWalkPlans(planned.map((w) => w.plan))
        setStatus({ status: refused ? { kind: 'failed', reason: refused } : { kind: 'idle' }, at })
        if (refused) return
        setOutcomes(result)
        setWanted('walks')
      })
      .finally(release)
  }

  return (
    <GoalPickerView
      step={step}
      onStep={setWanted}
      landing={landing}
      landingProblem={landingProblem}
      picking={picking}
      landingRating={landing ? landingRatingAt(rating, landing) : undefined}
      landingColours={rating.status === 'ready' ? { status: 'ready', method: rating.method } : rating}
      // The view can be flown wherever the landing site can be picked: not on the surface, not in navigation.
      site={canPick ? { name: DEFAULT_SITE.site.name, onGoTo: () => useSite.getState().goToSite() } : undefined}
      onPickLanding={canPick ? () => useRoutePick.getState().startRoutePick('landing-site') : undefined}
      settings={settings}
      onSettings={setSettings}
      onCancelPick={() => useRoutePick.getState().cancelRoutePick()}
      onUseSelected={
        canPick && selected && selected !== landing ? () => useLandingSite.getState().setLandingSite(selected) : undefined
      }
      plan={plan}
      status={shown}
      onPlan={onPlan}
      walks={walksOfPlans(outcomes, plans)}
      onSelectWalk={(kind) => {
        const index = planIndexOfKind(plans, kind)
        if (index !== null) useWalkPlan.getState().selectWalk(index)
      }}
      canStand={canStand}
      onStand={standAtWalkStart}
    />
  )
}
