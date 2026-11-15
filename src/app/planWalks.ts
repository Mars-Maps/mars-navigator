import {
  SUITED_SLOPE_LIMIT,
  WALK_KINDS,
  derived,
  isAvailable,
  unavailable,
  walkPlanProblem,
  type Classified,
  type MarsCoordinate,
  type MissionSettings,
  type SampleStop,
  type ScienceGoal,
  type SlopeLimit,
  type WalkKind,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../domain'
import { legSlopeToFlag } from '../features/mission-ui/slopeLimit'
import type { ElevationProfile } from '../features/route-analysis/elevationProfile'
import { surfaceDistanceKm } from '../features/route-analysis/routeDistance'
import {
  fitsSettings,
  maxSamplesThatFit,
  placeSamples,
  walkBudget,
  type WalkBudget,
  type WalkFit,
} from '../features/route-analysis/walkBudget'

/**
 * The three scientific walks of Plan a walk, planned side by side.
 * Each walk's own module chooses its stops; the shell
 * then walks the legs at the settings' slope limit, reads the
 * heights along them, places the samples and costs the walk, and
 * checks the plan against the contract. One walk that fails never
 * fails the others.
 */

/** What a walk's own planner hands the shell: its stops and, if it has them, its own sample places. */
export interface WalkDraft {
  /** What the walk is for, as `WalkPlan.goal`. */
  goal: ScienceGoal
  /** In walking order; the first is the landing site. At least two. */
  stops: WalkStop[]
  /** Km along the walk where its samples belong (unit contacts); evenly spaced without. */
  placesKm?: readonly number[]
  /**
   * The samples, where the walk places and fits them itself (the transect,
   * the rover check): taken as they are, the shell only costs and checks
   * them. Without, the shell places them (`placesKm`, else evenly).
   */
  samples?: readonly SampleStop[]
  /** What the walk leaves out and why, a sentence each, for the panel. */
  notes?: readonly string[]
}

export type DraftWalk = (start: MarsCoordinate, settings: MissionSettings, signal: AbortSignal) => Promise<Classified<WalkDraft>>

/** What `planWalks` needs, the data read behind each part so features never see the adapters. */
export interface WalksPlanner {
  /** Each kind's stops; UNAVAILABLE with the reason where that walk cannot be made. */
  drafts: Readonly<Record<WalkKind, DraftWalk>>
  walkLegs: (stops: readonly WalkStop[], signal: AbortSignal, limit: SlopeLimit) => Promise<WalkLeg[]>
  /** The elevation profile along `path`, for the budget and the samples. */
  profile: (path: readonly MarsCoordinate[], signal: AbortSignal) => Promise<Classified<ElevationProfile>>
}

/** One walk as the panel shows it: planned, with its cost against the settings, or why not. */
export type WalkOutcome =
  | {
      kind: WalkKind
      status: 'planned'
      plan: WalkPlan
      /** Time and energy with the samples placed; beside the plan, not on it. */
      budget: WalkBudget
      fit: WalkFit
      /** Why fewer samples than the settings ask for, or null when all of them are on the walk. */
      samplesNote: string | null
    }
  | { kind: WalkKind; status: 'unavailable'; reason: string }

export type PlannedWalkOutcome = Extract<WalkOutcome, { status: 'planned' }>

/**
 * The settings' max slope as a plan's slope limit. The cited figure stays
 * cited; any other value is the user's own choice and says so.
 */
export function slopeLimitOf(settings: MissionSettings): SlopeLimit {
  if (settings.maxSlopeDeg === SUITED_SLOPE_LIMIT.deg) return SUITED_SLOPE_LIMIT
  return {
    deg: settings.maxSlopeDeg,
    label: 'set in the mission settings, not a cited figure',
    source: `Plan a walk mission settings; the cited figure is ${SUITED_SLOPE_LIMIT.deg}° (${SUITED_SLOPE_LIMIT.source})`,
  }
}

/** Every kind of walk from `start`, in `WALK_KINDS` order, or 'aborted' when `signal` aborts first. */
export async function planWalks(
  planner: WalksPlanner,
  start: MarsCoordinate,
  settings: MissionSettings,
  signal: AbortSignal,
): Promise<WalkOutcome[] | 'aborted'> {
  const outcomes = await Promise.all(WALK_KINDS.map((kind) => planOneWalk(planner, kind, start, settings, signal)))
  return signal.aborted ? 'aborted' : outcomes
}

/** The planned walks of `outcomes`, for the walk-plan store, in the same order. */
export function plannedWalks(outcomes: readonly WalkOutcome[]): PlannedWalkOutcome[] {
  return outcomes.filter((o): o is PlannedWalkOutcome => o.status === 'planned')
}

/** Why no walk could be planned, one clause per walk numbered as `WALK_KINDS`; for the panel when none is. */
export function noWalkReason(outcomes: readonly WalkOutcome[]): string {
  return outcomes
    .map((o, i) => (o.status === 'unavailable' ? `walk ${i + 1}: ${o.reason}` : null))
    .filter((r) => r !== null)
    .join('; ')
}

async function planOneWalk(
  planner: WalksPlanner,
  kind: WalkKind,
  start: MarsCoordinate,
  settings: MissionSettings,
  signal: AbortSignal,
): Promise<WalkOutcome> {
  const fail = (reason: string): WalkOutcome => ({ kind, status: 'unavailable', reason })
  try {
    const draft = await planner.drafts[kind](start, settings, signal)
    if (draft.classification === 'UNAVAILABLE') return fail(draft.reason)
    const { goal, placesKm, notes = [] } = draft.value
    const slopeLimit = slopeLimitOf(settings)
    const own = draft.value.samples
    let stops: readonly WalkStop[] = draft.value.stops
    let leftOff = 0
    for (;;) {
      const [legs, profile] = await Promise.all([
        planner.walkLegs(stops, signal, slopeLimit),
        planner.profile(
          stops.map((s) => s.coordinate),
          signal,
        ),
      ])
      if (profile.classification === 'UNAVAILABLE') return fail(`The heights along the walk could not be read: ${profile.reason}`)

      const placed = own ? { samples: [...own], note: null } : samplesFor(profile.value, settings, placesWithin(placesKm, stops))
      const { samples } = placed
      // The walk's slope is its legs' slope, the figure their flags show, so
      // the fit and the flags never disagree; the profile's stretches only
      // keep samples off steep ground.
      const budget = { ...walkBudget(profile.value, samples.length), steepestDeg: steepestLeg(legs) }
      const fit = fitsSettings(budget, settings)
      // A walk whose stops were chosen on level ground can cost more on its real heights. It must
      // still get back within the settings: the farthest stop goes, and the shorter walk is costed again.
      if (!own && canShorten(stops) && fit.breaks.some((b) => b.limit !== 'slope')) {
        stops = [...stops.slice(0, -2), stops[stops.length - 1]]
        leftOff++
        continue
      }
      const shortened =
        leftOff === 0
          ? null
          : `${leftOff} stop${leftOff === 1 ? ' was' : 's were'} left off: on the heights along the walk, going that far and coming back was over the time or the energy of the settings`
      const note = joinSentences([placed.note, shortened, ...notes])
      const plan: WalkPlan = { goal, stops, legs, slopeLimit, kind, settings, samples }
      const problem = walkPlanProblem(plan)
      if (problem !== null) return fail(problem)
      return { kind, status: 'planned', plan, budget, fit, samplesNote: note }
    }
  } catch (e) {
    return fail(`The planner failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Whether a walk that ends where it began can lose its farthest stop and
 * still be a walk: the start, two places or more, and the way back.
 */
function canShorten(stops: readonly WalkStop[]): boolean {
  if (stops.length < 4) return false
  const first = stops[0].coordinate
  const last = stops[stops.length - 1].coordinate
  return first.latitude === last.latitude && first.longitudeEast === last.longitudeEast
}

/**
 * The walk's own sample places that are still on it: `placesKm` is measured
 * along the way out as the draft made it, so with stops left off only the
 * places up to the last stop kept hold. Unchanged for a walk as drafted.
 */
function placesWithin(placesKm: readonly number[] | undefined, stops: readonly WalkStop[]): readonly number[] | undefined {
  if (!placesKm) return undefined
  let outKm = 0
  // Up to the last place visited: the closing stop is the way back, where no sample of the draft lies.
  for (let i = 1; i < stops.length - 1; i++) outKm += surfaceDistanceKm(stops[i - 1].coordinate, stops[i].coordinate)
  return placesKm.filter((km) => km <= outKm + 1e-9)
}

/** Sentences joined into one note, each ending in a full stop; null with none. */
export function joinSentences(parts: readonly (string | null)[]): string | null {
  const sentences = parts.filter((p): p is string => p !== null && p.trim() !== '').map((p) => p.trim().replace(/([^.!?])$/, '$1.'))
  return sentences.length === 0 ? null : sentences.join(' ')
}

/**
 * The steepest of the legs, as each leg's flag reads it (`legSlopeToFlag`);
 * UNAVAILABLE when any leg's slope is unknown, never read as flat.
 */
export function steepestLeg(legs: readonly WalkLeg[]): Classified<number> {
  let worst = 0
  for (const leg of legs) {
    const slope = legSlopeToFlag(leg.steepestSlopeDeg, leg.hazards)
    if (!isAvailable(slope)) return unavailable(`A leg's slope is not known: ${slope.reason}`)
    worst = Math.max(worst, slope.value)
  }
  return derived(worst, "The steepest of the walk's legs, each measured as its slope flag reads it")
}

/**
 * As many of the settings' samples as the duration leaves room for
 * (`maxSamplesThatFit`), placed on the walk (`placeSamples`), with why any
 * are missing.
 */
function samplesFor(
  profile: ElevationProfile,
  settings: MissionSettings,
  placesKm: readonly number[] | undefined,
): { samples: SampleStop[]; note: string | null } {
  const walking = walkBudget(profile, 0)
  const room = maxSamplesThatFit(walking, settings)
  const count = room.classification === 'UNAVAILABLE' ? settings.samples : Math.min(settings.samples, room.value)
  const placed = placeSamples(profile, count, { maxSlopeDeg: settings.maxSlopeDeg, ...(placesKm ? { placesKm } : {}) })
  const samples = placed.classification === 'UNAVAILABLE' ? [] : placed.value.samples
  const missing = settings.samples - samples.length
  if (missing === 0) return { samples, note: null }
  if (placed.classification === 'UNAVAILABLE') return { samples, note: placed.reason }
  const overEnergy = isAvailable(walking.walkingKcal) && walking.walkingKcal.value > settings.energyKcal
  if (count === 0 && overEnergy) {
    return { samples, note: `The walking alone is over the ${settings.energyKcal} kcal energy budget, so no samples fit` }
  }
  if (count < settings.samples) {
    return { samples, note: `The walking leaves time for ${count} of the ${settings.samples} samples within ${settings.durationMin} min` }
  }
  return { samples, note: `${missing} of the ${settings.samples} samples found no room on the walk` }
}
