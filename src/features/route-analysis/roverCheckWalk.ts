import {
  derived,
  isValidCoordinate,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MissionSettings,
  type RoverMotionCounter,
  type RoverTraverse,
  type ScienceGoal,
  type SampleStop,
  type TraversePoint,
} from '../../domain'
import type { ElevationProfile } from './elevationProfile'
import { surfaceDistanceKm } from './routeDistance'
import { DEFAULT_MAX_WALK_KM } from './scienceGoals'
import { fitsSettings, MIN_SAMPLE_SPACING_M, SAMPLE_MINUTES, walkBudget, type WalkBudget, type WalkLimit } from './walkBudget'

/**
 * Walk 3 of 3, verifying rover measurements: a walk from the landing
 * site to places Perseverance has stood, with a sample at each. Offered
 * only where the site has a rover traverse (Jezero).
 *
 * Two pure steps with a height read between them, so this module never
 * reads anything itself:
 *   1. `roverCheckStops` picks waypoints of the traverse, nearest first.
 *   2. The shell reads the elevation profile along the path they make.
 *   3. `fitRoverCheck` cuts the walk back to the most stops whose time,
 *      energy and slope fit the settings (`walkBudget`).
 *
 * The walk says what it revisits, never a value the rover measured: the app
 * holds the rover's path and photos, not its instrument readings.
 */

/** Why there is no walk 3. */
export const ROVER_CHECK_REASONS = {
  noTraverse: 'No rover has driven at this site, so there is no rover measurement to check here (only at Jezero)',
  notPerseverance: "This walk revisits Perseverance's waypoints; the traverse read is another rover's",
  noWaypoint: `No Perseverance waypoint is within ${DEFAULT_MAX_WALK_KM} km of this landing site`,
  noSamples: 'The settings ask for no samples, and this walk is a sample at each waypoint',
} as const

/**
 * The waypoints are the nearest ones, not where the rover took its own
 * samples: no official list of sampling sols is in the app (an open
 * question).
 */
const WAYPOINT_CHOICE =
  "Perseverance waypoints nearest first: from the landing site to the nearest, then on to the nearest not yet visited, none within the samples' minimum spacing of the landing site or of each other. Nearest, not the rover's own sampling sites: no official list of sampling sols is held"

/**
 * The goal the plan carries: the walk's purpose in words that claim
 * no measurement. It names no geologic unit, which the contract allows for
 * this kind of walk only: the stops are where the rover was, whatever the
 * ground.
 */
export const ROVER_CHECK_GOAL: ScienceGoal = {
  id: 'rover-check',
  label: 'Rover check',
  unitNames: [],
  reason: derived(
    "A sample at places Perseverance has been, to set beside the rover's photos there. No rover measurement is read: the app holds the rover's path and photos, not its instrument readings",
    WAYPOINT_CHOICE,
  ),
}

/** A stop on the walk at a rover waypoint, with what ties it to the rover's photos there. */
export interface RoverCheckStop {
  coordinate: MarsCoordinate
  /** OFFICIAL, from the traverse. */
  sol: number
  rmc: RoverMotionCounter
  /** The traverse point as published. */
  waypoint: TraversePoint
}

export interface RoverCheckCandidate {
  start: MarsCoordinate
  /** In walking order; the walk is the straight lines start → stops[0] → stops[1] …. */
  stops: RoverCheckStop[]
  /** The traverse's source line, for the method. */
  source: string
}

export interface RoverCheckOptions {
  /** How far from the start a waypoint may be, km; DEFAULT_MAX_WALK_KM by default. */
  reachKm?: number
  /** The closest two stops may be, m; MIN_SAMPLE_SPACING_M by default. */
  minSpacingM?: number
}

/**
 * Up to `settings.samples` waypoints of `traverse` within reach of `start`,
 * nearest first. `traverse` is null where the site has no rover traverse,
 * and UNAVAILABLE when it could not be read: either way this walk is
 * UNAVAILABLE with the reason and never throws, so the other walks plan.
 */
export function roverCheckStops(
  start: MarsCoordinate,
  traverse: Classified<RoverTraverse> | null,
  settings: MissionSettings,
  options: RoverCheckOptions = {},
): Classified<RoverCheckCandidate> {
  if (traverse === null) return unavailable(ROVER_CHECK_REASONS.noTraverse)
  if (traverse.classification === 'UNAVAILABLE') {
    return unavailable(`The Perseverance traverse could not be read: ${traverse.reason}`)
  }
  if (traverse.value.rover !== 'perseverance') return unavailable(ROVER_CHECK_REASONS.notPerseverance)
  if (settings.samples < 1) return unavailable(ROVER_CHECK_REASONS.noSamples)
  const reachKm = options.reachKm ?? DEFAULT_MAX_WALK_KM
  const minKm = (options.minSpacingM ?? MIN_SAMPLE_SPACING_M) / 1000

  const inReach = traverse.value.points.filter(
    (p) => isValidCoordinate(p.coordinate) && surfaceDistanceKm(start, p.coordinate) <= reachKm,
  )
  if (inReach.length === 0) return unavailable(ROVER_CHECK_REASONS.noWaypoint)

  const stops: RoverCheckStop[] = []
  const left = [...inReach]
  let here = start
  while (stops.length < settings.samples && left.length > 0) {
    let best = -1
    let bestKm = Number.POSITIVE_INFINITY
    for (let i = 0; i < left.length; i++) {
      const c = left[i].coordinate
      // Not on the landing site itself, nor on a stop already taken.
      if (surfaceDistanceKm(start, c) < minKm || stops.some((s) => surfaceDistanceKm(s.coordinate, c) < minKm)) continue
      const km = surfaceDistanceKm(here, c)
      if (km < bestKm) [best, bestKm] = [i, km]
    }
    if (best < 0) break
    const [p] = left.splice(best, 1)
    stops.push({ coordinate: p.coordinate, sol: p.sol, rmc: p.rmc, waypoint: p })
    here = p.coordinate
  }
  if (stops.length === 0) return unavailable(ROVER_CHECK_REASONS.noWaypoint)
  return derived({ start, stops, source: traverse.value.source }, `${WAYPOINT_CHOICE}; within ${reachKm} km of the landing site. Waypoints: ${traverse.value.source}`)
}

/** The path the shell reads heights along: the start, then each stop. */
export function roverCheckPath(candidate: RoverCheckCandidate): MarsCoordinate[] {
  return [candidate.start, ...candidate.stops.map((s) => s.coordinate)]
}

export interface RoverCheckWalk {
  start: MarsCoordinate
  /** The waypoints kept, in walking order. */
  stops: RoverCheckStop[]
  /** Start then stops: the straight lines walked. */
  path: MarsCoordinate[]
  /** One at each stop, in walking order, SAMPLE_MINUTES each. */
  samples: SampleStop[]
  budget: WalkBudget
  /** Waypoints of the candidate left off to fit, and the limit the next one would break. */
  cut: {
    count: number
    /** The limit the next waypoint would break; null when none breaks or the next could not be checked. */
    limit: WalkLimit | null
    /** Why the next waypoint could not be checked (a figure unknown, e.g. a missing height); null when it could. */
    unchecked: { limits: WalkLimit[]; reason: string } | null
  }
}

/**
 * The longest start of the candidate walk that fits `settings`: each extra
 * stop is one more sample and the walk to it, kept while the time, energy
 * and slope all stay within the settings. `profile` is the elevation profile
 * along `roverCheckPath(candidate)`. UNAVAILABLE, with the limit, when not
 * even the first stop fits, or when a figure needed to check is unknown.
 */
export function fitRoverCheck(
  candidate: RoverCheckCandidate,
  profile: ElevationProfile,
  settings: MissionSettings,
): Classified<RoverCheckWalk> {
  const path = roverCheckPath(candidate)
  const atKm: number[] = []
  let km = 0
  for (let i = 1; i < path.length; i++) {
    km += surfaceDistanceKm(path[i - 1], path[i])
    atKm.push(km)
  }

  let kept = 0
  let keptBudget: WalkBudget | null = null
  let stoppedBy: WalkLimit | null = null
  let unchecked: { limits: WalkLimit[]; reason: string } | null = null
  for (let k = 1; k <= candidate.stops.length; k++) {
    const budget = walkBudget(upTo(profile, atKm[k - 1]), k)
    const fit = fitsSettings(budget, settings)
    // A figure unknown on the way to waypoint k: the walk stops before it, keeping those that fit.
    if (fit.fits === null && kept > 0) {
      unchecked = { limits: fit.unknown, reason: unknownReason(budget) }
      break
    }
    if (fit.fits === null) {
      return unavailable(
        `The walk to waypoint ${k} cannot be checked against the settings (${fit.unknown.join(', ')} not known): ${unknownReason(budget)}`,
      )
    }
    if (!fit.fits) {
      stoppedBy = fit.breaks[0].limit
      break
    }
    kept = k
    keptBudget = budget
  }
  if (kept === 0 || keptBudget === null) {
    return unavailable(`Not even the nearest waypoint fits the settings: the walk to it breaks the ${stoppedBy ?? 'settings'} limit`)
  }

  const stops = candidate.stops.slice(0, kept)
  return derived(
    {
      start: candidate.start,
      stops,
      path: path.slice(0, kept + 1),
      samples: stops.map((s, i) => ({ id: `sample-${i + 1}`, order: i + 1, coordinate: s.coordinate, dwellMin: SAMPLE_MINUTES })),
      budget: keptBudget,
      cut: { count: candidate.stops.length - kept, limit: stoppedBy, unchecked },
    },
    `${WAYPOINT_CHOICE}. A sample at each waypoint, not evenly spaced. Cut back to the most waypoints whose walk and samples fit the duration, energy and slope limit of the settings. Waypoints: ${candidate.source}`,
  )
}

/** The profile from its start to `km` along it: a prefix, since the profile includes every waypoint as a sample. */
function upTo(profile: ElevationProfile, km: number): ElevationProfile {
  const samples = profile.samples.filter((s) => s.distanceKm <= km + 1e-9)
  return { samples, totalDistanceKm: samples.length > 0 ? samples[samples.length - 1].distanceKm : 0 }
}

function unknownReason(b: WalkBudget): string {
  for (const f of [b.totalMin, b.walkingKcal, b.steepestDeg]) if (f.classification === 'UNAVAILABLE') return f.reason
  return 'a figure is not known'
}
