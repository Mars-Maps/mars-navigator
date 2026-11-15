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
import { spannedAreaKm2 } from '../features/route-analysis/sampleSpread'
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
   * `placesKm` again for a shorter way out, `path` being the stops kept
   * without the way back: asked when the shell leaves a stop off, so the
   * samples are spread over the walk that is left, not only cut to it.
   */
  placesFor?: (path: readonly MarsCoordinate[]) => readonly number[]
  /**
   * The walk is a loop: its way back is over ground not walked yet, so the
   * samples go round the whole of it. Without, a walk that comes back is
   * sampled on the way out only. A loop cut to one place is no loop.
   */
  loop?: boolean
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
    const { goal, placesFor, loop = false, notes = [] } = draft.value
    let placesKm = draft.value.placesKm
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

      const placed = own ? { samples: [...own], note: null } : samplesFor(profile.value, settings, placesKm, loop && stops.length >= 4 ? undefined : wayOutKm(stops))
      const { samples } = placed
      // The walk's slope is its legs' slope, the figure their flags show, so
      // the fit and the flags never disagree; the profile's stretches only
      // keep samples off steep ground.
      const budget = { ...walkBudget(profile.value, samples.length), steepestDeg: steepestLeg(legs) }
      const fit = fitsSettings(budget, settings)
      // A walk whose stops were chosen on level ground can cost more on its real heights. It must
      // still get back within the settings: the last place visited goes, and the shorter walk is costed again.
      if (!own && canShorten(stops) && fit.breaks.some((b) => b.limit !== 'slope')) {
        stops = [...stops.slice(0, -2), stops[stops.length - 1]]
        leftOff++
        placesKm = placesOnShorter(placesKm, placesFor, stops)
        continue
      }
      const shortened =
        leftOff === 0
          ? null
          : `${leftOff} stop${leftOff === 1 ? ' was' : 's were'} left off the end of the walk: on the heights along the walk, going on to ${leftOff === 1 ? 'it' : 'them'} and coming back was over the time or the energy of the settings`
      const spread = loop && stops.length >= 4 ? spreadNote(samples) : null
      const note = joinSentences([placed.note, shortened, spread, ...notes])
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
 * Whether a walk that ends where it began can lose its last place visited
 * and still be a walk: the start, two places or more, and the way back.
 */
function canShorten(stops: readonly WalkStop[]): boolean {
  return stops.length >= 4 && returnsToStart(stops)
}

/** Whether the walk's last stop is its first again: the way back to the landing site. */
function returnsToStart(stops: readonly WalkStop[]): boolean {
  if (stops.length < 3) return false
  const first = stops[0].coordinate
  const last = stops[stops.length - 1].coordinate
  return first.latitude === last.latitude && first.longitudeEast === last.longitudeEast
}

/**
 * Km along the walk where its way out ends, summed stop to stop as the
 * profile sums it: the last place visited of a walk that returns to its
 * start. Undefined for a walk that does not return, all of which is the way out.
 */
function wayOutKm(stops: readonly WalkStop[]): number | undefined {
  if (!returnsToStart(stops)) return undefined
  let km = 0
  for (let i = 1; i < stops.length - 1; i++) km += surfaceDistanceKm(stops[i - 1].coordinate, stops[i].coordinate)
  return km
}

/**
 * The walk's own sample places once a stop is left off. The draft places
 * them again on the shorter way out where it can (`placesFor`), so the
 * samples are spread over the ground still walked; without, only the
 * places up to the last stop kept hold. None left means evenly spaced.
 */
function placesOnShorter(
  placesKm: readonly number[] | undefined,
  placesFor: WalkDraft['placesFor'],
  stops: readonly WalkStop[],
): readonly number[] | undefined {
  if (!placesKm) return undefined
  const outKm = wayOutKm(stops) ?? Infinity
  const places = placesFor ? placesFor(stops.slice(0, -1).map((s) => s.coordinate)) : placesKm.filter((km) => km <= outKm + 1e-9)
  return places.length > 0 ? places : undefined
}

/** How widely a loop's samples are spread, for its note; null with too few to span any ground. */
function spreadNote(samples: readonly SampleStop[]): string | null {
  const km2 = spannedAreaKm2(samples.map((s) => s.coordinate))
  // Short on the card; what the figure is and is not is `SPANNED_AREA_METHOD`, in the walk's method.
  return km2 > 0 ? `The samples span ${km2.toFixed(2)} km² (the area inside their outline, not ground measured)` : null
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
 * (`maxSamplesThatFit`), placed on the walk's way out (`placeSamples`, up
 * to `uptoKm`), with why any are missing.
 */
function samplesFor(
  profile: ElevationProfile,
  settings: MissionSettings,
  placesKm: readonly number[] | undefined,
  uptoKm: number | undefined,
): { samples: SampleStop[]; note: string | null } {
  const walking = walkBudget(profile, 0)
  const room = maxSamplesThatFit(walking, settings)
  const count = room.classification === 'UNAVAILABLE' ? settings.samples : Math.min(settings.samples, room.value)
  const placed = placeSamples(profile, count, {
    maxSlopeDeg: settings.maxSlopeDeg,
    ...(placesKm ? { placesKm } : {}),
    // A walk that comes back is sampled on the way out only: the way back is for coming back.
    ...(uptoKm === undefined ? {} : { uptoKm }),
  })
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
