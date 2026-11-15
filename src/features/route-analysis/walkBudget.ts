import { derived, unavailable, type Classified, type MissionSettings, type SampleStop } from '../../domain'
import { pointAlong, type ElevationProfile } from './elevationProfile'
import { METABOLIC_COST_METHOD, walkingKcalPerKm } from './metabolicCost'
import { WALKING_SPEED_METHOD, suitedWalkingKmh } from './walkingSpeed'

/**
 * The walk budget: what a walk along a path costs in time and
 * energy, whether it fits the mission settings, and where its
 * samples go. Pure: the shell reads the path's heights into an
 * `ElevationProfile` (`planProfile`, `profileFromHeights`) and asks here.
 *
 * Each stretch is the ground between two consecutive profile samples: its
 * slope is the rise over the run, its time the run over the suited pace,
 * its energy the run times the Minetti cost. Neither model is a Mars measurement, and every figure says so.
 */

/**
 * Minutes one sample collection takes: a project choice, not a cited
 * one.
 */
export const SAMPLE_MINUTES = 5

/**
 * The closest two samples may be, metres: a project choice, so a walk's
 * samples are spread along it rather than bunched; not a cited figure.
 */
export const MIN_SAMPLE_SPACING_M = 100

/** Why a figure or a placement is UNAVAILABLE. */
export const WALK_BUDGET_REASONS = {
  noHeight:
    'The elevation models have no height on part of the walk, so its slope there, and the time and energy it costs, are not known',
  tooShort: 'The walk has fewer than two points with a distance between them',
  samplingEnergy:
    'No cited figure was found for the energy spent standing while a sample is collected, so it is not counted',
  badCount: 'The number of samples is not a whole number of zero or more',
  noRoom: 'No ground on the walk is both within the slope limit and far enough from the other samples',
} as const

// Shown behind the figures' badges, so it names no one: who set it is in the comment above.
const SAMPLING_TIME_METHOD = `${SAMPLE_MINUTES} min per sample, a project choice, not a cited figure`

/** One stretch of the walk between two consecutive profile samples. */
interface Stretch {
  fromKm: number
  toKm: number
  /** Degrees, uphill and downhill alike; NaN where a height is missing. */
  slopeDeg: number
  /** Rise over run, uphill positive; NaN where a height is missing. */
  gradient: number
}

function stretches(profile: ElevationProfile): Stretch[] {
  const out: Stretch[] = []
  const s = profile.samples
  for (let i = 1; i < s.length; i++) {
    const runKm = s[i].distanceKm - s[i - 1].distanceKm
    if (!(runKm > 0)) continue
    const a = s[i - 1].elevationMeters
    const b = s[i].elevationMeters
    const gradient =
      a.classification === 'UNAVAILABLE' || b.classification === 'UNAVAILABLE'
        ? Number.NaN
        : (b.value - a.value) / (runKm * 1000)
    out.push({
      fromKm: s[i - 1].distanceKm,
      toKm: s[i].distanceKm,
      gradient,
      slopeDeg: (Math.atan(Math.abs(gradient)) * 180) / Math.PI,
    })
  }
  return out
}

export interface WalkBudget {
  /** Along the path, km. */
  distanceKm: Classified<number>
  /** Walking only, minutes. */
  walkingMin: Classified<number>
  /** Samples × SAMPLE_MINUTES. */
  samplingMin: Classified<number>
  /** Walking plus sampling, minutes. */
  totalMin: Classified<number>
  /** Walking only, kcal: the energy the settings' budget is checked against. */
  walkingKcal: Classified<number>
  /** UNAVAILABLE: no cited figure for standing at a sample. */
  samplingKcal: Classified<number>
  /** The steepest stretch walked, degrees. */
  steepestDeg: Classified<number>
}

/** The time and energy a walk along `profile` costs with `samples` collections on it. */
export function walkBudget(profile: ElevationProfile, samples: number): WalkBudget {
  const parts = stretches(profile)
  const countable = Number.isInteger(samples) && samples >= 0
  const samplingTotal = countable ? samples * SAMPLE_MINUTES : Number.NaN
  const samplingMin = countable ? derived(samplingTotal, SAMPLING_TIME_METHOD) : unavailable<number>(WALK_BUDGET_REASONS.badCount)
  const samplingKcal = unavailable<number>(WALK_BUDGET_REASONS.samplingEnergy)
  if (parts.length === 0) {
    const none = unavailable<number>(WALK_BUDGET_REASONS.tooShort)
    return { distanceKm: none, walkingMin: none, samplingMin, totalMin: none, walkingKcal: none, samplingKcal, steepestDeg: none }
  }
  const distanceKm = derived(
    parts.reduce((sum, p) => sum + (p.toKm - p.fromKm), 0),
    'Along the path, as the elevation profile measures it (haversine, spherical Mars)',
  )
  if (parts.some((p) => Number.isNaN(p.gradient))) {
    const none = unavailable<number>(WALK_BUDGET_REASONS.noHeight)
    return { distanceKm, walkingMin: none, samplingMin, totalMin: none, walkingKcal: none, samplingKcal, steepestDeg: none }
  }
  let hours = 0
  let kcal = 0
  let steepest = 0
  for (const p of parts) {
    const km = p.toKm - p.fromKm
    hours += km / suitedWalkingKmh(p.gradient)
    kcal += km * walkingKcalPerKm(p.gradient)
    steepest = Math.max(steepest, p.slopeDeg)
  }
  const walking = hours * 60
  const stretchesMethod = `over the ${parts.length} stretches between the elevation profile's samples, each stretch's slope its rise over its run`
  return {
    distanceKm,
    walkingMin: derived(walking, `Sum of each stretch's length over the walking speed, ${stretchesMethod}. ${WALKING_SPEED_METHOD}`),
    samplingMin,
    totalMin: countable
      ? derived(walking + samplingTotal, `Walking time plus ${SAMPLING_TIME_METHOD}. Walking: ${WALKING_SPEED_METHOD}`)
      : unavailable<number>(WALK_BUDGET_REASONS.badCount),
    walkingKcal: derived(
      kcal,
      `Sum of each stretch's length times the cost of walking its slope, ${stretchesMethod}; standing at the samples is not counted (no cited figure). ${METABOLIC_COST_METHOD}`,
    ),
    samplingKcal,
    steepestDeg: derived(steepest, `The steepest stretch, ${stretchesMethod}; ground rougher than the sample spacing is averaged out, and a short stretch between two cells of the elevation model can read steeper than the ground is`),
  }
}

export type WalkLimit = 'duration' | 'energy' | 'slope'

/** A limit the walk breaks, and by how much in the limit's unit (min, kcal, °). */
export interface LimitBreak {
  limit: WalkLimit
  over: number
  /** How the figure that breaks the limit was worked out: the budget figure's own method. */
  method: string
}

/**
 * What a fit on energy means, for whoever shows it: the walking only. The
 * energy spent standing at the samples is UNAVAILABLE, so a walk within the
 * energy budget here spends more than the figure checked, by an unknown amount.
 */
export const ENERGY_FIT_CAVEAT =
  'The energy checked is the walking only: no cited figure was found for the energy spent standing at the samples, so the walk spends more than this by an unknown amount'

export interface WalkFit {
  /** True within every limit; false when one breaks; null when a figure is UNAVAILABLE and none breaks. */
  fits: boolean | null
  breaks: LimitBreak[]
  /** The limits that cannot be checked, their figure UNAVAILABLE. */
  unknown: WalkLimit[]
  /** ENERGY_FIT_CAVEAT, on every fit: a view that says "fits" says this with it. */
  energyCaveat: string
}

/** Whether `budget` fits `settings`: within the duration, within the energy, no stretch over the slope limit. */
export function fitsSettings(budget: WalkBudget, settings: MissionSettings): WalkFit {
  const checks: [WalkLimit, Classified<number>, number][] = [
    ['duration', budget.totalMin, settings.durationMin],
    ['energy', budget.walkingKcal, settings.energyKcal],
    ['slope', budget.steepestDeg, settings.maxSlopeDeg],
  ]
  const breaks: LimitBreak[] = []
  const unknown: WalkLimit[] = []
  for (const [limit, figure, max] of checks) {
    if (figure.classification === 'UNAVAILABLE') unknown.push(limit)
    else if (figure.value > max) breaks.push({ limit, over: figure.value - max, method: figure.classification === 'DERIVED' ? figure.method : figure.source })
  }
  return { fits: breaks.length > 0 ? false : unknown.length > 0 ? null : true, breaks, unknown, energyCaveat: ENERGY_FIT_CAVEAT }
}

/**
 * The most samples the duration allows on this walk: the time left after
 * walking, in whole SAMPLE_MINUTES. Energy does not limit the count, since
 * standing at a sample is not costed; a walk already over its energy fits
 * no samples. 0 when the walking alone breaks a limit. UNAVAILABLE where
 * the walking time or energy is.
 */
export function maxSamplesThatFit(budget: WalkBudget, settings: MissionSettings): Classified<number> {
  if (budget.walkingMin.classification === 'UNAVAILABLE') return budget.walkingMin
  if (budget.walkingKcal.classification === 'UNAVAILABLE') return budget.walkingKcal
  const method = `The duration left after walking (${budget.walkingMin.value.toFixed(0)} min of ${settings.durationMin} min), in whole samples of ${SAMPLING_TIME_METHOD}; none when the walking alone is over the energy budget`
  if (budget.walkingKcal.value > settings.energyKcal) return derived(0, method)
  return derived(Math.max(0, Math.floor((settings.durationMin - budget.walkingMin.value) / SAMPLE_MINUTES)), method)
}

export interface PlaceSamplesOptions {
  /** No sample on a stretch steeper than this, degrees. */
  maxSlopeDeg: number
  /** Metres; MIN_SAMPLE_SPACING_M by default. */
  minSpacingM?: number
  /**
   * The walk's own places, km along the path (unit contacts, rover
   * waypoints), taken in order of distance in place of even spacing.
   */
  placesKm?: readonly number[]
}

export interface SamplePlacement {
  /** In walking order, `order` 1…n, each SAMPLE_MINUTES long. */
  samples: SampleStop[]
  /** How many asked for could not be placed; 0 when all were. */
  missing: number
}

/**
 * Up to `count` samples on the walk, evenly spaced by distance along it
 * (or at `placesKm`), never two closer than the minimum spacing and none on
 * a stretch over the slope limit or with no height. A target that falls on
 * such ground moves to the nearest allowed point. Fewer than `count` when
 * the walk has no more room, with `missing` saying how many.
 */
export function placeSamples(profile: ElevationProfile, count: number, options: PlaceSamplesOptions): Classified<SamplePlacement> {
  const parts = stretches(profile)
  if (parts.length === 0) return unavailable(WALK_BUDGET_REASONS.tooShort)
  const minKm = (options.minSpacingM ?? MIN_SAMPLE_SPACING_M) / 1000
  const want = Math.max(0, Math.floor(count))
  const allowed = mergeIntervals(
    parts.filter((p) => p.slopeDeg <= options.maxSlopeDeg).map((p): [number, number] => [p.fromKm, p.toKm]),
  )
  const totalKm = parts[parts.length - 1].toKm - parts[0].fromKm
  const startKm = parts[0].fromKm
  const targets = options.placesKm
    ? [...options.placesKm].filter(Number.isFinite).sort((a, b) => a - b)
    : Array.from({ length: want }, (_, i) => startKm + (totalKm * (i + 1)) / (want + 1))

  const placed: number[] = []
  for (const target of targets) {
    if (placed.length === want) break
    // Free ground: allowed stretches less a minimum spacing either side of each placed sample.
    let free = allowed
    for (const p of placed) free = subtractInterval(free, p - minKm, p + minKm)
    let best = Number.NaN
    for (const [a, b] of free) {
      const at = Math.min(b, Math.max(a, target))
      if (Number.isNaN(best) || Math.abs(at - target) < Math.abs(best - target)) best = at
    }
    // A walk's own place is taken where it is, or not at all.
    if (Number.isNaN(best) || (options.placesKm && best !== target)) continue
    placed.push(best)
  }
  placed.sort((a, b) => a - b)

  const samples = placed.map((km, i) => ({
    id: `sample-${i + 1}`,
    order: i + 1,
    coordinate: coordinateAt(profile, km),
    dwellMin: SAMPLE_MINUTES,
  }))
  const spacing = `never two closer than ${minKm * 1000} m (a project choice)`
  const where = options.placesKm ? "at the walk's own places" : 'evenly spaced by distance along the walk'
  const value = { samples, missing: want - samples.length }
  if (want > 0 && samples.length === 0) return unavailable(WALK_BUDGET_REASONS.noRoom)
  return derived(
    value,
    `${samples.length} sample${samples.length === 1 ? '' : 's'} ${where}, ${spacing}, none on a stretch steeper than ${options.maxSlopeDeg}° or with no height; a target on such ground moves to the nearest allowed point. ${SAMPLING_TIME_METHOD}`,
  )
}

/** The point `km` along the profile, between the two samples either side of it on the path. */
function coordinateAt(profile: ElevationProfile, km: number) {
  const s = profile.samples
  for (let i = 1; i < s.length; i++) {
    if (km <= s[i].distanceKm) {
      const run = s[i].distanceKm - s[i - 1].distanceKm
      const t = run > 0 ? (km - s[i - 1].distanceKm) / run : 0
      return pointAlong(s[i - 1].coordinate, s[i].coordinate, Math.min(1, Math.max(0, t)))
    }
  }
  return s[s.length - 1].coordinate
}

type Interval = [number, number]

function mergeIntervals(list: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** `list` less the open interval (lo, hi): its edges stay free, so samples exactly the spacing apart are allowed. */
function subtractInterval(list: Interval[], lo: number, hi: number): Interval[] {
  const out: Interval[] = []
  for (const [a, b] of list) {
    if (b <= lo || a >= hi) out.push([a, b])
    else {
      if (a <= lo) out.push([a, lo])
      if (b >= hi) out.push([hi, b])
    }
  }
  return out
}
