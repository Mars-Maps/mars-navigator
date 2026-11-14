import {
  SHIELDING_WARNING_FRACTION,
  derived,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type Hazard,
  type MarsCoordinate,
  type SlopeLimit,
  type WalkLeg,
  type WalkStop,
} from '../../domain'
import { pointAlong, planProfile, profilePointPairs, type ProfilePlan } from './elevationProfile'
import { CRATER_NEAR_KM, OBSTACLE_KINDS, mappedObstacleHazards } from './mappedObstacles'
import type { SlopeModel } from './pointSlope'
import { slopeDegrees } from './profileSlope'
import { legShieldingHazards, shieldingNotChecked } from './atmosphericShielding'

/**
 * The walk between the stops: one leg per pair of stops, each the
 * straight great-circle line between them, sampled on the elevation chain
 * and checked against a cited slope limit, the atmospheric shielding line
 * and what the geologic map marks.
 *
 * The route is not steered around anything: a steep stretch or a ridge
 * crest is flagged where the line meets it, for the astronaut to judge.
 */

/**
 * Heights for a leg's samples, each with the model that answered, as
 * `SlopeRead` gives them to `slopeAtPoint`. Only the answering model says how
 * coarse a height is: inside a fine model's grid a coarser one often answers.
 */
export interface WalkHeightRead {
  /** Metres, nearest cell; NaN where no model has a height. */
  heights: Float32Array
  /** Index into `models` per height; ignored where the height is NaN. */
  model: Uint8Array
  models: readonly SlopeModel[]
}

/** The elevation chain's heights at (lat, lon) pairs. */
export type WalkHeights = (points: Float64Array, signal: AbortSignal) => Promise<Classified<WalkHeightRead>>

/**
 * A slope is measured over at least this many cells of the coarsest model in
 * the stretch. A nearest-cell height can sit up to half a cell off along each
 * axis, so the run can be out by about 1.4 cells at worst: over 5 cells a
 * figure is at most about 1.3x too steep (over 2 cells it would be 1.7x).
 */
export const SLOPE_BASELINE_CELLS = 5

/** The finest cell size, km, a path may be sampled at; the model that answers can be coarser. */
export type CellKmAlong = (path: readonly MarsCoordinate[]) => number

const PATH_METHOD =
  'The straight great-circle line between the two stops, sampled for heights; not routed around steep ground or obstacles'
const DISTANCE_METHOD = 'Great-circle length of the leg (haversine on a sphere of the Mars mean radius)'

export async function walkLegs(
  stops: readonly WalkStop[],
  heights: WalkHeights,
  cellKmAlong: CellKmAlong,
  obstacles: Classified<GeologicFeatures>,
  limit: SlopeLimit,
  signal: AbortSignal,
): Promise<WalkLeg[]> {
  throwIfAborted(signal)
  const pairs = stops.slice(1).map((to, i) => ({ from: stops[i], to }))
  const plans = pairs.map(({ from, to }) => {
    const ends = [from.coordinate, to.coordinate]
    return planProfile(ends, { minSpacingKm: cellKmAlong(ends) })
  })

  // One read for every leg's samples.
  const sampled = plans.flatMap((p) => (p.classification === 'UNAVAILABLE' ? [] : [p.value]))
  const all = new Float64Array(sampled.reduce((n, p) => n + p.points.length * 2, 0))
  let offset = 0
  for (const p of sampled) {
    all.set(profilePointPairs(p), offset)
    offset += p.points.length * 2
  }
  const read: Classified<WalkHeightRead> =
    all.length === 0 ? unavailable('No leg has any ground to sample') : await heights(all, signal)
  throwIfAborted(signal)
  if (read.classification !== 'UNAVAILABLE') assertAligned(read.value, all.length / 2)

  let at = 0
  return pairs.map(({ from, to }, i) => {
    const plan = plans[i]
    if (plan.classification === 'UNAVAILABLE') return unplannedLeg(from, to, plan.reason)
    const n = plan.value.points.length
    const legRead: Classified<WalkHeightRead> =
      read.classification === 'UNAVAILABLE'
        ? read
        : {
            ...read,
            value: {
              heights: read.value.heights.subarray(at, at + n),
              model: read.value.model.subarray(at, at + n),
              models: read.value.models,
            },
          }
    at += n
    return measuredLeg(from, to, plan.value, legRead, obstacles, limit)
  })
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
}

/** Refuses a read that does not line up with the samples, rather than misreading it. */
function assertAligned(read: WalkHeightRead, samples: number) {
  if (read.heights.length !== samples || read.model.length !== samples) {
    throw new Error(`The elevation source answered ${read.heights.length} heights for ${samples} samples`)
  }
  for (let i = 0; i < samples; i++) {
    if (Number.isNaN(read.heights[i])) continue
    if (!(read.models[read.model[i]]?.cellKm > 0)) {
      throw new Error('A height came from an elevation model the slope does not know')
    }
  }
}

/** A leg with no line to walk: two stops at one place, or at opposite sides of Mars. */
function unplannedLeg(from: WalkStop, to: WalkStop, reason: string): WalkLeg {
  return {
    fromStopId: from.id,
    toStopId: to.id,
    path: unavailable(reason),
    distanceKm: unavailable(reason),
    steepestSlopeDeg: unavailable(reason),
    hazards: unavailable(reason),
  }
}

function measuredLeg(
  from: WalkStop,
  to: WalkStop,
  plan: ProfilePlan,
  read: Classified<WalkHeightRead>,
  obstacles: Classified<GeologicFeatures>,
  limit: SlopeLimit,
): WalkLeg {
  const idBase = `${from.id}-${to.id}`
  const base = {
    fromStopId: from.id,
    toStopId: to.id,
    path: derived(
      plan.points.map((p) => p.coordinate),
      PATH_METHOD,
    ),
    distanceKm: derived(plan.totalDistanceKm, DISTANCE_METHOD),
  }
  const mapped = mappedObstacleHazards(from.coordinate, to.coordinate, obstacles, idBase)
  if (read.classification === 'UNAVAILABLE') {
    // The slope and shielding are unknown, but what the map marks along the leg is still known.
    const reason = `The slope was not checked: ${read.reason}`
    const notChecked: Hazard = {
      id: `${idBase}-slope-1`,
      kind: 'slope',
      unit: '°',
      coordinate: from.coordinate,
      magnitude: unavailable(reason),
    }
    const radiation = shieldingNotChecked(from.coordinate, idBase, read.reason)
    return {
      ...base,
      steepestSlopeDeg: read,
      hazards: derived([notChecked, radiation, ...mapped], `${reason}. ${obstacleMethod(obstacles)}`),
    }
  }

  const slopes = slopeScan(plan, read.value, limit, idBase)
  const { heights, model, models } = read.value
  const radiation = legShieldingHazards(plan.points, heights, idBase, (i) => models[model[i]].source)
  const steepestSlopeDeg: Classified<number> =
    slopes.steepest === null
      ? unavailable(`No stretch of this leg could be measured: ${slopes.notChecked.join('; ')}`)
      : slopes.notCheckedKm > 0
        ? unavailable(
            `${describeKm(slopes.notCheckedKm)} of this leg was not checked (${slopes.notChecked.join('; ')}), so its steepest slope is not known; the steepest measured stretch is ${slopes.steepest.toFixed(1)}°`,
          )
        : derived(slopes.steepest, slopes.method)

  return {
    ...base,
    steepestSlopeDeg,
    hazards: derived(
      [...slopes.hazards, ...radiation, ...mapped],
      `Each stretch checked against ${limit.deg}° (${limit.label}; ${limit.source}). Each sample with a height checked for atmospheric shielding under ${SHIELDING_WARNING_FRACTION} of Gale's column. ${obstacleMethod(obstacles)}`,
    ),
  }
}

interface SlopeScan {
  hazards: Hazard[]
  /** The steepest measured stretch, degrees; null when none could be measured. */
  steepest: number | null
  /** Length of the ground no measurement covers, km. */
  notCheckedKm: number
  /** Why that ground was not checked. */
  notChecked: string[]
  /** How the slopes were measured. */
  method: string
}

/** One measurement: a mean slope, and the middle of the ground it spans. */
interface Measured {
  deg: number
  at: MarsCoordinate
}

const NO_HEIGHT = 'no elevation model has a height there'
const MODEL_SWITCH = 'the heights switch between a site model and the global one, and that step would read as a slope'
const TOO_CLOSE = `the ground is too close to a gap, a model switch or the end of the leg to measure over ${SLOPE_BASELINE_CELLS} cells of its elevation model`

/**
 * The mean slope from every sample to the first later one at least
 * `SLOPE_BASELINE_CELLS` cells of the coarsest model between them away.
 * A measurement stops at a missing height or a switch between a site model
 * and the global one. Each stretch between samples then takes the steepest
 * measurement over it; a stretch none covers was not checked, never 0. Each
 * run over the limit or not checked is one hazard.
 */
function slopeScan(plan: ProfilePlan, read: WalkHeightRead, limit: SlopeLimit, idBase: string): SlopeScan {
  const pts = plan.points
  const { heights: h, model, models } = read
  const switchesModel = (i: number, j: number) =>
    model[i] !== model[j] && !(models[model[i]].site && models[model[j]].site)

  const over = new Array<Measured | null>(pts.length - 1).fill(null)
  let steepest: number | null = null
  let shortestKm = Number.POSITIVE_INFINITY
  let longestKm = 0
  for (let i = 0; i < pts.length - 1; i++) {
    if (Number.isNaN(h[i])) continue
    let coarsestKm = models[model[i]].cellKm
    for (let j = i + 1; j < pts.length; j++) {
      if (Number.isNaN(h[j]) || switchesModel(i, j)) break
      coarsestKm = Math.max(coarsestKm, models[model[j]].cellKm)
      const runKm = pts[j].distanceKm - pts[i].distanceKm
      // A little slack, so a run of exactly the baseline is not missed for rounding.
      if (runKm < SLOPE_BASELINE_CELLS * coarsestKm * (1 - 1e-9)) continue
      const deg = slopeDegrees(h[j] - h[i], runKm)
      const measured = { deg, at: pointAlong(pts[i].coordinate, pts[j].coordinate, 0.5) }
      for (let k = i; k < j; k++) {
        const known = over[k]
        if (known === null || deg > known.deg) over[k] = measured
      }
      steepest = Math.max(steepest ?? 0, deg)
      shortestKm = Math.min(shortestKm, runKm)
      longestKm = Math.max(longestKm, runKm)
      break
    }
  }

  type Run = { steep: Measured | null; why: Set<string>; startKm: number; endKm: number; at: MarsCoordinate }
  const runs: Run[] = []
  const notChecked = new Set<string>()
  let notCheckedKm = 0
  let open: Run | null = null
  for (let k = 0; k < over.length; k++) {
    const measured = over[k]
    if (measured !== null && measured.deg <= limit.deg) {
      open = null
      continue
    }
    const a = pts[k]
    const b = pts[k + 1]
    if (open === null || (open.steep === null) !== (measured === null)) {
      const at = measured?.at ?? pointAlong(a.coordinate, b.coordinate, 0.5)
      open = { steep: measured, why: new Set(), startKm: a.distanceKm, endKm: b.distanceKm, at }
      runs.push(open)
    }
    open.endKm = b.distanceKm
    if (measured === null) {
      const why = Number.isNaN(h[k]) || Number.isNaN(h[k + 1]) ? NO_HEIGHT : switchesModel(k, k + 1) ? MODEL_SWITCH : TOO_CLOSE
      open.why.add(why)
      notChecked.add(why)
      notCheckedKm += b.distanceKm - a.distanceKm
    } else if (open.steep !== null && measured.deg > open.steep.deg) {
      open.steep = measured
      open.at = measured.at
    }
  }

  const method = measuredMethod(plan, read, shortestKm, longestKm)
  const hazards = runs.map((run, n): Hazard => {
    const where = `${describeKm(run.startKm)} to ${describeKm(run.endKm)} along the leg`
    return {
      id: `${idBase}-slope-${n + 1}`,
      kind: 'slope',
      unit: '°',
      coordinate: run.at,
      magnitude:
        run.steep !== null
          ? derived(run.steep.deg, `Steepest stretch from ${where}, over ${limit.deg}°. ${method}`)
          : unavailable(`The ground from ${where} was not checked against ${limit.deg}°: ${[...run.why].join('; ')}`),
    }
  })
  return { hazards, steepest, notCheckedKm, notChecked: [...notChecked], method }
}

/** How a leg's slopes were measured, naming the models that answered on it, finest first. */
function measuredMethod(plan: ProfilePlan, read: WalkHeightRead, shortestKm: number, longestKm: number): string {
  const used = new Set<number>()
  read.heights.forEach((height, i) => {
    if (!Number.isNaN(height)) used.add(read.model[i])
  })
  const sources = [...used]
    .map((m) => read.models[m])
    .sort((a, b) => a.cellKm - b.cellKm)
    .map((m) => m.source)
  const shortest = describeKm(shortestKm)
  const longest = describeKm(longestKm)
  const baseline = shortest === longest ? `about ${shortest}` : `${shortest} to ${longest}`
  return `Mean slope over ${baseline} of ground, at least ${SLOPE_BASELINE_CELLS} cells of the coarsest elevation model in the stretch, uphill and downhill alike, from the nearest cell's height at samples about ${describeKm(plan.spacingKm)} apart along the leg. A nearest-cell height can make a figure up to about 1.3 times too steep, and steeper ground shorter than ${longest} is averaged out. Ground where the heights switch between a site model and the global one is not checked. Heights: ${sources.join(' | ')}`
}

/** What was checked on the map, for the hazards' method; an unread map says so as a hazard too. */
function obstacleMethod(obstacles: Classified<GeologicFeatures>): string {
  if (obstacles.classification === 'UNAVAILABLE') return `Mapped obstacles not checked: ${obstacles.reason}`
  const kinds = [...OBSTACLE_KINDS.lines, ...OBSTACLE_KINDS.areas].map((k) => `"${k}"`).join(', ')
  return `Checked for crossings of ${kinds}, and "${OBSTACLE_KINDS.points[0]}" points within ${CRATER_NEAR_KM * 1000} m of the leg (a project choice), from ${provenanceOf(obstacles)}`
}

function provenanceOf(c: Classified<unknown>): string {
  return c.classification === 'OFFICIAL' || c.classification === 'SIMULATED'
    ? c.source
    : c.classification === 'DERIVED'
      ? c.method
      : c.reason
}

function describeKm(km: number): string {
  if (km >= 10) return `${km.toFixed(0)} km`
  if (km >= 1) return `${km.toFixed(1)} km`
  return `${(km * 1000).toFixed(0)} m`
}
