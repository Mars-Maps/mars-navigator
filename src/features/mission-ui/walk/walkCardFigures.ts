import { WALK_KINDS, isAvailable, type Classified, type WalkKind, type WalkPlan } from '../../../domain'
import type { WalkBudget, WalkFit, WalkLimit } from '../../route-analysis/walkBudget'
import { formatDuration } from './missionSettings'

/**
 * Step 3 of Plan a walk: the three walks as cards. This file holds
 * what the cards show and in what order; `WalkCards.tsx` draws them. Every
 * figure is the walk budget's or the plan's own, and whether a limit
 * breaks is the budget's `fitsSettings`; nothing is worked out here.
 */

/**
 * One walk as the shell hands it to step 3: planned, with its budget and
 * fit against the settings, or why not. The shape of the shell's
 * `WalkOutcome` (`src/app/planWalks.ts`), repeated here because a feature
 * does not import the shell; TypeScript checks the two match where the
 * shell passes them in.
 */
export type WalkOption =
  | {
      kind: WalkKind
      status: 'planned'
      plan: WalkPlan
      budget: WalkBudget
      fit: WalkFit
      /** Why fewer samples than the settings ask for, and the walk's own notes (what it leaves out and why), or null. */
      samplesNote: string | null
    }
  | { kind: WalkKind; status: 'unavailable'; reason: string }

export type PlannedWalk = Extract<WalkOption, { status: 'planned' }>

/**
 * Each walk's name and what it is for, in a few words. The rover check
 * revisits places the rover has been: the app
 * holds the rover's path and photos, not its instrument readings.
 */
export const WALK_KIND_TEXT: Readonly<Record<WalkKind, { name: string; purpose: string }>> = {
  'flat-bedrock': {
    name: 'Flat bedrock',
    purpose: 'Explores the flat bedrock of the crater floor, with the samples spread across it, and comes back to the landing site.',
  },
  'rim-to-floor': {
    name: 'Rim to floor',
    purpose: 'How the ground changes from the crater rim to the floor: a sample on each geologic unit crossed, then back to the landing site.',
  },
  'rover-check': {
    name: 'Rover check',
    purpose: 'A sample at places Perseverance has been, to set beside what it saw there, then back to the landing site. Jezero only.',
  },
}

const LIMIT_NAME: Readonly<Record<WalkLimit, string>> = { duration: 'time', energy: 'energy', slope: 'slope' }

/** How far over a limit, in the limit's unit: "25 min", "40 kcal", "3.2°". */
function overText(limit: WalkLimit, over: number): string {
  if (limit === 'duration') return formatDuration(Math.max(1, Math.round(over)))
  if (limit === 'energy') return `${Math.max(1, Math.round(over))} kcal`
  return `${over.toFixed(1)}°`
}

/** The walks in the contract's order (`WALK_KINDS`), whatever order the shell sent them in. */
export function orderedWalks(walks: readonly WalkOption[]): WalkOption[] {
  return [...walks].sort((a, b) => WALK_KINDS.indexOf(a.kind) - WALK_KINDS.indexOf(b.kind))
}

/** Where the walk of `kind` is in the store's `plans`, for `selectWalk`; null when it is not there. */
export function planIndexOfKind(plans: readonly WalkPlan[], kind: WalkKind): number | null {
  const i = plans.findIndex((p) => p.kind === kind)
  return i === -1 ? null : i
}

/**
 * `walks` while the store still holds every plan they carry, else none:
 * once the plans are cleared or replaced (the sample walk), the cards of the
 * old run would describe walks that are no longer there.
 */
export function walksOfPlans(walks: readonly WalkOption[], plans: readonly WalkPlan[]): readonly WalkOption[] {
  const planned = walks.filter((w) => w.status === 'planned')
  return planned.length > 0 && planned.every((w) => plans.includes(w.plan)) ? walks : []
}

/** A figure on a card: the value with its mark, and the limit it is held to. */
export interface CardFigure {
  key: 'distance' | 'time' | 'energy' | 'slope'
  label: string
  value: Classified<number>
  format: (v: number) => string
  /** "of 4 h"; null with no limit for this figure, no settings on the plan, or an unavailable value (nothing to hold to it). */
  limit: string | null
  /** The budget's fit says this limit breaks. */
  over: boolean
}

export function cardFigures({ plan, budget, fit }: PlannedWalk): CardFigure[] {
  const s = plan.settings
  const over = (limit: WalkLimit) => fit.breaks.some((b) => b.limit === limit)
  const figures: CardFigure[] = [
    { key: 'distance', label: 'Distance', value: budget.distanceKm, format: (km) => `${km.toFixed(2)} km`, limit: null, over: false },
    {
      key: 'time',
      label: 'Time',
      value: budget.totalMin,
      format: (min) => formatDuration(Math.round(min)),
      limit: s ? `of ${formatDuration(s.durationMin)}` : null,
      over: over('duration'),
    },
    {
      key: 'energy',
      // The budget checks the walking only: standing at a sample is not costed.
      label: 'Walking energy',
      value: budget.walkingKcal,
      format: (kcal) => `${Math.round(kcal)} kcal`,
      limit: s ? `of ${s.energyKcal} kcal` : null,
      over: over('energy'),
    },
    {
      key: 'slope',
      label: 'Steepest',
      value: budget.steepestDeg,
      format: (deg) => `${deg.toFixed(1)}°`,
      limit: s ? `of ${s.maxSlopeDeg}°` : null,
      over: over('slope'),
    },
  ]
  return figures.map((f) => (isAvailable(f.value) ? f : { ...f, limit: null }))
}

/** "5 of 6 samples", "1 sample"; null for a plan with no samples. */
export function samplesLine(plan: WalkPlan): string | null {
  if (plan.samples === undefined) return null
  const n = plan.samples.length
  const noun = (plan.settings?.samples ?? n) === 1 ? 'sample' : 'samples'
  return plan.settings ? `${n} of ${plan.settings.samples} ${noun}` : `${n} ${noun}`
}

/** "Over: time by 25 min, slope by 3.2°"; null when no limit breaks. */
export function brokenLine(fit: WalkFit): string | null {
  if (fit.breaks.length === 0) return null
  return `Over: ${fit.breaks.map((b) => `${LIMIT_NAME[b.limit]} by ${overText(b.limit, b.over)}`).join(', ')}`
}

/** "Not checked: energy (its figure is unavailable)"; null when every limit could be checked. */
export function uncheckedLine(fit: WalkFit): string | null {
  if (fit.unknown.length === 0) return null
  const names = fit.unknown.map((l) => LIMIT_NAME[l]).join(', ')
  return `Not checked: ${names} (${fit.unknown.length === 1 ? 'its figure is' : 'their figures are'} unavailable)`
}

/** The caveat every fit carries on energy (`ENERGY_FIT_CAVEAT`): one line under the cards, from the first planned walk. */
export function energyCaveat(walks: readonly WalkOption[]): string | null {
  const planned = walks.find((w): w is PlannedWalk => w.status === 'planned')
  return planned ? planned.fit.energyCaveat : null
}

/** Whether the walk's last stop is its start again: the closing stop, the way back. */
export function endsAtStart(stops: readonly { coordinate: { latitude: number; longitudeEast: number } }[]): boolean {
  if (stops.length < 3) return false
  const first = stops[0].coordinate
  const last = stops[stops.length - 1].coordinate
  return first.latitude === last.latitude && first.longitudeEast === last.longitudeEast
}

/**
 * A plan's stops in words. The start is not a numbered stop, and neither is
 * the closing stop of a walk that ends back where it began: "the start, 2
 * stops and the way back" for Start, Stop 1, Stop 2 and the return.
 */
export function stopsPhrase(stops: readonly { coordinate: { latitude: number; longitudeEast: number } }[]): string {
  const returns = endsAtStart(stops)
  const places = stops.length - 1 - (returns ? 1 : 0)
  const counted = places === 1 ? '1 stop' : `${places} stops`
  return returns ? `the start, ${counted} and the way back` : `the start and ${counted}`
}
