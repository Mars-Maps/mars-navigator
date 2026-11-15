import {
  derived,
  official,
  unavailable,
  type Classified,
  type GeologicUnitArea,
  type MarsCoordinate,
  type MissionSettings,
  type ScienceGoal,
  type WalkStop,
} from '../../domain'
import { walkingKcalPerKm } from './metabolicCost'
import { surfaceDistanceKm } from './routeDistance'
import {
  DEFAULT_MAX_STOPS,
  DEFAULT_MAX_WALK_KM,
  SCIENCE_GOALS,
  candidateStops,
  insideRings,
  stopName,
  stopReason,
  tangentPlane,
  type Xy,
} from './scienceGoals'
import { MIN_SAMPLE_SPACING_M, SAMPLE_MINUTES } from './walkBudget'
import { suitedWalkingKmh, WALKING_SPEED_METHOD } from './walkingSpeed'

/**
 * Walk 1 of Plan a walk: exploring the flat bedrock. From the
 * landing site, a walk over the crater-floor units of the site's geologic
 * map, with its samples spread over the floor ground it crosses. Pure: the
 * shell reads the map's units and hands them in, confirms each stop's unit
 * at its exact point (`confirmStops`), and costs the walk against the
 * settings with its heights (`walkBudget`, `planWalks`).
 *
 * "Bedrock" is read as the map's crater-floor units, the pair the "Crater
 * floor" goal already names. Nothing is said about
 * what the ground is made of beyond the map's own text.
 */

/** The "Crater floor" goal: its units are the walk's ground, and its reasons quote the map. */
export const FLAT_BEDROCK_GOAL: ScienceGoal = (() => {
  const goal = SCIENCE_GOALS.find((g) => g.id === 'crater-floor')
  if (!goal) throw new Error('The science goals have no "crater-floor" goal for the flat-bedrock walk')
  return goal
})()

/** Most stops after the landing site, as the single-goal planner allows (`DEFAULT_MAX_STOPS`). */
export const FLAT_BEDROCK_MAX_STOPS = DEFAULT_MAX_STOPS

/** How far a sample place stands from where the walk crosses onto or off the floor, km: as a stop stands inside its polygon. */
export const FLOOR_INSET_KM = 0.05

/** The step at which the walk is checked for floor ground, km: fine beside the sample spacing. */
const FLOOR_STEP_KM = 0.01

export const FLAT_BEDROCK_REASONS = {
  noTime: (settings: MissionSettings) =>
    `The ${settings.durationMin} min duration leaves no time to walk after even one sample of ${SAMPLE_MINUTES} min`,
  noEnergy: (settings: MissionSettings) => `The ${settings.energyKcal} kcal energy budget leaves nothing to walk on`,
  noFloor: (reachKm: number) =>
    `No ground of the crater-floor units (${FLAT_BEDROCK_GOAL.unitNames.join(', ')}) is within ${reachKm.toFixed(2)} km of the landing site, as far as the settings let the walk go`,
  otherUnits: "The map's read at each stop's exact point names another unit than the crater floor's, so no stop is left on it",
} as const

/** What bounds the walk's reach, in a stop's reason: the settings, not a fixed range. */
export const FLAT_BEDROCK_REACH_BASIS = 'as far as the mission settings let the walk go on level ground'

/**
 * How many samples the walk keeps time for: the settings' count, or fewer
 * when they would leave no time to walk (fewer samples rather than no
 * walk). 0 only when the settings ask for none; null when not even one
 * sample leaves time to walk.
 */
export function flatBedrockSamples(settings: MissionSettings): number | null {
  for (let k = Math.max(0, Math.floor(settings.samples)); k >= 0; k--) {
    if (settings.durationMin - k * SAMPLE_MINUTES > 0) return k === 0 && settings.samples > 0 ? null : k
  }
  return null
}

/**
 * How far the walk may go in all, km, before its heights are read: the
 * shorter of what the time left after the samples and the energy budget
 * allow on level ground, and no farther than the map is read around the
 * landing site (`DEFAULT_MAX_WALK_KM`). Level ground is the walk's own
 * premise; the shell then costs the walk on its real heights and reports
 * any limit it still breaks.
 */
export function flatBedrockReachKm(settings: MissionSettings): Classified<number> {
  const samples = flatBedrockSamples(settings)
  if (samples === null) return unavailable(FLAT_BEDROCK_REASONS.noTime(settings))
  const walkingMin = settings.durationMin - samples * SAMPLE_MINUTES
  if (!(settings.energyKcal > 0)) return unavailable(FLAT_BEDROCK_REASONS.noEnergy(settings))
  const byTime = (walkingMin / 60) * suitedWalkingKmh(0)
  const byEnergy = settings.energyKcal / walkingKcalPerKm(0)
  const km = Math.min(byTime, byEnergy, DEFAULT_MAX_WALK_KM)
  return derived(
    km,
    `The shorter of ${byTime.toFixed(2)} km (the ${walkingMin} min left after ${samples} samples of ${SAMPLE_MINUTES} min${samples < settings.samples ? `, fewer than the ${settings.samples} asked for so that there is time to walk` : ''}, at the level-ground pace) and ${byEnergy.toFixed(2)} km (the ${settings.energyKcal} kcal budget at the level-ground cost), and at most ${DEFAULT_MAX_WALK_KM} km, as far as the map is read. ${WALKING_SPEED_METHOD}`,
  )
}

export interface FlatBedrockDraft {
  goal: ScienceGoal
  /** The landing site, then the stops in walking order. */
  stops: WalkStop[]
  /** The walk's length allowance the stops were chosen within, km. */
  reachKm: number
  /** How many samples the reach keeps time for (`flatBedrockSamples`). */
  samples: number
  /** How each stop after the landing site was placed, by its id, for its reason once the map confirms it. */
  placements: Readonly<Record<string, string>>
}

/**
 * The landing site and up to `FLAT_BEDROCK_MAX_STOPS` stops on the
 * crater-floor units, within the walk's reach. The candidates are
 * `candidateStops`' (one per floor polygon, the point of it nearest the
 * landing site, in nearest-neighbour order); a stop is kept while the walk
 * to it, stop to stop, stays within the reach. UNAVAILABLE with the reason
 * when the settings leave no walk or no floor ground is within reach.
 */
export function flatBedrockStops(
  start: MarsCoordinate,
  units: readonly GeologicUnitArea[],
  settings: MissionSettings,
): Classified<FlatBedrockDraft> {
  const reach = flatBedrockReachKm(settings)
  if (reach.classification === 'UNAVAILABLE') return reach
  const reachKm = reach.value
  let candidates: WalkStop[]
  try {
    // Every floor polygon in reach, so the length check below chooses, not the count.
    candidates = candidateStops(FLAT_BEDROCK_GOAL, start, units, { maxWalkKm: reachKm, maxStops: Number.MAX_SAFE_INTEGER })
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e))
  }
  const stops: WalkStop[] = [candidates[0]]
  let walkedKm = 0
  for (const stop of candidates.slice(1)) {
    if (stops.length > FLAT_BEDROCK_MAX_STOPS) break
    const legKm = surfaceDistanceKm(stops[stops.length - 1].coordinate, stop.coordinate)
    if (walkedKm + legKm > reachKm) continue
    walkedKm += legKm
    stops.push(stop)
  }
  const samples = flatBedrockSamples(settings) ?? 0
  const reachMethod = reach.classification === 'DERIVED' ? reach.method : reach.source
  const nearest = `the point of that unit's polygon nearest the landing site, ${FLOOR_INSET_KM * 1000} m inside it`
  if (stops.length >= 2) {
    const placements = Object.fromEntries(stops.slice(1).map((s) => [s.id, nearest]))
    // Each stop's reason says what bounds the reach: the settings, not a fixed range.
    const reasoned = stops.map((s, i) =>
      i === 0 || s.unit.classification === 'UNAVAILABLE'
        ? s
        : { ...s, reason: stopReason(FLAT_BEDROCK_GOAL, s.unit.value, reachKm, { placement: nearest, reachBasis: FLAT_BEDROCK_REACH_BASIS }) },
    )
    return derived(
      { goal: FLAT_BEDROCK_GOAL, stops: reasoned, reachKm, samples, placements },
      `Stops on the crater-floor units of the site's geologic map (${FLAT_BEDROCK_GOAL.unitNames.join(', ')}), nearest first, kept while the walk stop to stop is within ${reachKm.toFixed(2)} km: ${reachMethod}`,
    )
  }
  // No other floor polygon in reach: a landing site on a large floor polygon walks across that one.
  const across = acrossFloorStops(start, units, reachKm)
  if (across === null) return unavailable(FLAT_BEDROCK_REASONS.noFloor(reachKm))
  return derived(
    {
      goal: FLAT_BEDROCK_GOAL,
      stops: [stops[0], ...across.stops],
      reachKm,
      samples,
      placements: Object.fromEntries(across.stops.map((s) => [s.id, across.placement])),
    },
    `Stops across the crater-floor polygon the landing site stands on (${across.unit}), out along the direction where it reaches farthest within ${reachKm.toFixed(2)} km: ${reachMethod}`,
  )
}

/** Directions tried for a walk across the floor polygon under the landing site: every 22.5°. */
const ACROSS_DIRECTIONS = 16

/**
 * Stops across the crater-floor polygon the landing site stands on, for a
 * site with no other floor polygon in reach (`candidateStops` skips the one
 * underfoot). Of `ACROSS_DIRECTIONS` straight lines out from the site, the
 * one that stays on the polygon farthest, up to the reach and
 * `FLOOR_INSET_KM` short of its edge, carries up to `FLAT_BEDROCK_MAX_STOPS`
 * stops evenly along it. Null when the site is on no floor polygon or no
 * line runs far enough for two samples.
 */
export function acrossFloorStops(
  start: MarsCoordinate,
  units: readonly GeologicUnitArea[],
  reachKm: number,
): { stops: WalkStop[]; placement: string; unit: string } | null {
  const plane = tangentPlane(start)
  const floorNames = new Set(FLAT_BEDROCK_GOAL.unitNames)
  const origin = { x: 0, y: 0 }
  const under = units
    .filter((a) => floorNames.has(a.unit.name))
    .map((a) => ({ unit: a.unit, rings: a.rings.map((r) => r.map(plane.project)).filter((r) => r.length >= 3) }))
    .find((a) => a.rings.length > 0 && insideRings(origin, a.rings))
  if (!under) return null

  let bestKm = 0
  let bestAngle = 0
  for (let d = 0; d < ACROSS_DIRECTIONS; d++) {
    const angle = (2 * Math.PI * d) / ACROSS_DIRECTIONS
    let km = 0
    for (let s = FLOOR_STEP_KM; s <= reachKm + 1e-9; s += FLOOR_STEP_KM) {
      if (!insideRings({ x: s * Math.sin(angle), y: s * Math.cos(angle) }, under.rings)) break
      km = s
    }
    // Short of the edge as a stop stands inside its polygon; the reach itself is ground still on the polygon.
    if (km < reachKm - 1e-9) km -= FLOOR_INSET_KM
    if (km > bestKm) [bestKm, bestAngle] = [km, angle]
  }
  if (bestKm < (2 * MIN_SAMPLE_SPACING_M) / 1000) return null

  const bearing = Math.round((bestAngle * 180) / Math.PI)
  const placement = `on a straight line out from the landing site across the floor polygon it stands on, bearing ${bearing}° from north, the direction of ${ACROSS_DIRECTIONS} tried in which the polygon reaches farthest; stops evenly along it, the last ${FLOOR_INSET_KM * 1000} m inside the polygon's edge or at the reach`
  const stops = Array.from({ length: FLAT_BEDROCK_MAX_STOPS }, (_, k): WalkStop => {
    const km = (bestKm * (k + 1)) / FLAT_BEDROCK_MAX_STOPS
    const n = k + 2
    return {
      id: `${FLAT_BEDROCK_GOAL.id}-${n}`,
      label: `${stopName(n)} · ${under.unit.name}`,
      coordinate: plane.unproject({ x: km * Math.sin(bestAngle), y: km * Math.cos(bestAngle) }),
      unit: official(under.unit, under.unit.map.citation),
      reason: stopReason(FLAT_BEDROCK_GOAL, under.unit, reachKm, { placement, reachBasis: FLAT_BEDROCK_REACH_BASIS }),
    }
  })
  return { stops, placement, unit: under.unit.name }
}

/**
 * Where the samples go, km along the walk through `path`: spread evenly
 * over the walk's floor ground, at least `FLOOR_INSET_KM` from where it
 * crosses onto or off the floor, and no two closer than the samples'
 * minimum spacing, so fewer than `count` when the floor ground is
 * short. Distances are summed leg by leg as the elevation profile sums them
 * (`planProfile`), so they are places on the walk's own profile. Empty
 * when the walk crosses no floor ground with room for a sample.
 */
export function floorSamplePlacesKm(
  path: readonly MarsCoordinate[],
  units: readonly GeologicUnitArea[],
  count: number,
): number[] {
  if (path.length < 2 || !(count > 0)) return []
  const plane = tangentPlane(path[0])
  const floorNames = new Set(FLAT_BEDROCK_GOAL.unitNames)
  const floor = units
    .filter((a) => floorNames.has(a.unit.name))
    .map((a) => a.rings.map((r) => r.map(plane.project)).filter((r) => r.length >= 3))
    .filter((rings) => rings.length > 0)
  const onFloor = (p: Xy) => floor.some((rings) => insideRings(p, rings))

  // The walk's floor stretches, km along it, each trimmed by the inset at both ends.
  const stretches: { from: number; to: number }[] = []
  let legStartKm = 0
  let open: number | null = null
  let lastKm = 0
  for (let i = 1; i < path.length; i++) {
    const a = plane.project(path[i - 1])
    const b = plane.project(path[i])
    const legKm = surfaceDistanceKm(path[i - 1], path[i])
    const steps = Math.max(1, Math.ceil(legKm / FLOOR_STEP_KM))
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps
      const km = legStartKm + legKm * t
      const inside = onFloor({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      if (inside && open === null) open = km
      if (!inside && open !== null) {
        stretches.push({ from: open, to: lastKm })
        open = null
      }
      lastKm = km
    }
    legStartKm += legKm
  }
  if (open !== null) stretches.push({ from: open, to: lastKm })
  const usable = stretches
    .map((s) => ({ from: s.from + FLOOR_INSET_KM, to: s.to - FLOOR_INSET_KM }))
    .filter((s) => s.to >= s.from)
  const lengthKm = usable.reduce((sum, s) => sum + (s.to - s.from), 0)
  if (usable.length === 0) return []

  // Even slices of the floor ground laid end to end, one sample at the middle of each.
  const minKm = MIN_SAMPLE_SPACING_M / 1000
  const n = Math.max(1, Math.min(count, Math.floor(lengthKm / minKm)))
  const places: number[] = []
  for (let k = 0; k < n; k++) {
    let along = ((k + 0.5) * lengthKm) / n
    for (const s of usable) {
      const len = s.to - s.from
      if (along <= len + 1e-12) {
        places.push(s.from + along)
        break
      }
      along -= len
    }
  }
  return places
}
