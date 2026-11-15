import type { Classified } from './classification'
import type { GeologicUnit } from './geology'
import { MARS_MEAN_RADIUS_KM, validateCoordinate, type MarsCoordinate } from './mars'
import type { Hazard } from './terrain'

/**
 * The planned Marswalk: the contract between the
 * planner that makes it (science goals, the walk route) and
 * everything that shows it (HUD, stop card, the surface walk). The planner writes one `WalkPlan` to the shared store; the views
 * only read it, so every screen shows the planner's figures and none works
 * out its own.
 *
 * Not in the plan: rover photos. A stop's photos come from the photo join
 * by the stop's coordinate, so the stop card asks for them itself. A
 * leg is the straight line between its stops, flagged where it meets a hazard,
 * not routed around one (`walkLegs`).
 */

/**
 * What the walk is for: a science goal tied to units of a geologic map. The
 * one exception is the rover check, whose stops are where the rover
 * was, whatever the ground: its goal names no unit, and its reason cites the
 * rover's traverse, not the map.
 */
export interface ScienceGoal {
  id: string
  /** As the UI names it, e.g. "Delta deposits". */
  label: string
  /** The map's unit names this goal visits, spelled as the map spells them; empty only for the rover check. */
  unitNames: readonly string[]
  /**
   * Why those units serve the goal: DERIVED, its method quoting the map's
   * own description or interpretation and naming the map. Never invented.
   */
  reason: Classified<string>
}

/** A place the walk stops at. The first stop is where the walk starts. */
export interface WalkStop {
  id: string
  /** As the UI names it, e.g. "Stop 2 · Jezero fan 1 unit". */
  label: string
  coordinate: MarsCoordinate
  /** The geologic unit under the stop: OFFICIAL from its map, or UNAVAILABLE with the reason (no map here, a contact, a failed read). */
  unit: Classified<GeologicUnit>
  /** Why this stop serves the goal, as for `ScienceGoal.reason`. */
  reason: Classified<string>
}

/** The walk from one stop to the next. */
export interface WalkLeg {
  fromStopId: string
  toStopId: string
  /** The line walked, both stops included: DERIVED with the routing method, or UNAVAILABLE. */
  path: Classified<MarsCoordinate[]>
  distanceKm: Classified<number>
  /**
   * The steepest stretch of the leg, degrees, uphill and downhill alike, as
   * the planner measured it on the elevation chain.
   */
  steepestSlopeDeg: Classified<number>
  /** Slope over the limit, mapped obstacles and the rest; an empty DERIVED list means scanned and none found. */
  hazards: Classified<Hazard[]>
  /**
   * The most, in metres, any point of the leg is from the rover's path: a distance, never a statement of safety. DERIVED, or UNAVAILABLE
   * with the reason. Absent where the planner did not measure it (the sample
   * plan), so a view shows no row rather than a value nobody worked out.
   */
  farthestFromRoverPathM?: Classified<number>
}

/** A slope figure the walk is checked against, with what it is and where it comes from. */
export interface SlopeLimit {
  deg: number
  /** What the figure is, in the UI's words. */
  label: string
  /** The citation. */
  source: string
}

/** The one cited figure for walking in a suit; not a Mars requirement. */
export const SUITED_SLOPE_LIMIT: SlopeLimit = {
  deg: 20,
  label: 'lunar xEVA figure, not a Mars requirement',
  source: 'NASA EVA-EXP-0075 (2020), p. 6: "Walking up/down/across a slope of up to 20°"',
}

/**
 * The three scientific walks of Plan a walk: bedrock on flat
 * ground, from the crater rim down to its floor, and along the rover's
 * own path to check what it saw.
 */
export const WALK_KINDS = ['flat-bedrock', 'rim-to-floor', 'rover-check'] as const
export type WalkKind = (typeof WALK_KINDS)[number]

/** The limits a walk is planned within, as the Plan a walk sliders set them. */
export interface MissionSettings {
  /** The steepest slope walked, degrees (what "max elevation" means here). */
  maxSlopeDeg: number
  /** How many samples are collected. */
  samples: number
  /** The energy the astronaut can spend, kcal. */
  energyKcal: number
  /** How long the walk may take, minutes. */
  durationMin: number
}

export type MissionSettingKey = keyof MissionSettings

/** A setting's default, with what it is and where it comes from, as `SlopeLimit`. */
export interface MissionSettingDefault {
  value: number
  /** What the default is, in a few words: the citation's label, or "project choice". */
  basis: string
  /** The citation behind the default; absent for a project choice. */
  source?: string
}

const PROJECT_CHOICE = 'project choice'

/**
 * The one table of defaults; the sliders read it. Only the slope is cited.
 * No source read for the project gives a suited sample
 * count, energy budget or walk duration on Mars, so those are project
 * choices and say so.
 */
export const MISSION_SETTING_DEFAULTS: Readonly<Record<MissionSettingKey, MissionSettingDefault>> = {
  maxSlopeDeg: { value: SUITED_SLOPE_LIMIT.deg, basis: SUITED_SLOPE_LIMIT.label, source: SUITED_SLOPE_LIMIT.source },
  samples: { value: 6, basis: PROJECT_CHOICE },
  energyKcal: { value: 600, basis: PROJECT_CHOICE },
  durationMin: { value: 240, basis: PROJECT_CHOICE },
}

export const DEFAULT_MISSION_SETTINGS: MissionSettings = {
  maxSlopeDeg: MISSION_SETTING_DEFAULTS.maxSlopeDeg.value,
  samples: MISSION_SETTING_DEFAULTS.samples.value,
  energyKcal: MISSION_SETTING_DEFAULTS.energyKcal.value,
  durationMin: MISSION_SETTING_DEFAULTS.durationMin.value,
}

/** A point on the walk's path where a sample is collected. */
export interface SampleStop {
  id: string
  /** 1 for the first sample collected, then 2, 3…, in walking order. */
  order: number
  /** On the walk's path (`walkPlanProblem` checks it). */
  coordinate: MarsCoordinate
  /** Minutes spent collecting it. */
  dwellMin: number
}

/**
 * How far, metres, a sample may be from the walk's path and still be on it:
 * a project choice, room for rounding where a planner places a sample along
 * a leg, not a measurement tolerance.
 */
export const SAMPLE_ON_PATH_TOLERANCE_M = 1

export interface WalkPlan {
  goal: ScienceGoal
  /** In walking order; the first is the start. At least two. */
  stops: readonly WalkStop[]
  /** `legs[i]` goes from `stops[i]` to `stops[i + 1]`: one fewer than the stops. */
  legs: readonly WalkLeg[]
  slopeLimit: SlopeLimit
  /**
   * Plan a walk's three walks. Optional: the goal-based walk and the
   * sample walk have none of them. Checked only when present.
   */
  kind?: WalkKind
  /** The settings the walk was planned within; `slopeLimit.deg` equals `settings.maxSlopeDeg`. */
  settings?: MissionSettings
  /** In any order in the list; `order` is the walking order. Needs `settings`, to be counted against. */
  samples?: readonly SampleStop[]
}

/**
 * Why `plan` breaks the contract above, or null when it keeps it. The store
 * refuses a broken plan, so a view never has to guess which leg goes where.
 */
export function walkPlanProblem(plan: WalkPlan): string | null {
  const { stops, legs, goal } = plan
  if (goal.id === '') return 'The goal has no id'
  // The rover check visits the rover's waypoints, not a unit of the map: only its goal may name none.
  if (goal.unitNames.length === 0 && plan.kind !== 'rover-check') return 'The goal names no geologic unit'
  if (stops.length < 2) return `A walk needs at least two stops, not ${stops.length}`
  for (const s of stops) {
    if (s.id === '') return 'A stop has no id'
    const check = validateCoordinate(s.coordinate)
    if (!check.ok) return `Stop ${s.id} is not at a valid coordinate (${check.reason})`
  }
  if (new Set(stops.map((s) => s.id)).size !== stops.length) return 'Two stops share an id'
  if (legs.length !== stops.length - 1) return `${stops.length} stops need ${stops.length - 1} legs, not ${legs.length}`
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].fromStopId !== stops[i].id || legs[i].toStopId !== stops[i + 1].id) {
      return `Leg ${i + 1} must go from ${stops[i].id} to ${stops[i + 1].id}`
    }
  }
  if (!(plan.slopeLimit.deg > 0 && plan.slopeLimit.deg < 90)) return `A slope limit of ${plan.slopeLimit.deg}° is not a slope`
  return missionProblem(plan)
}

/** The Plan a walk fields, each checked only when present. */
function missionProblem(plan: WalkPlan): string | null {
  const { kind, settings, samples } = plan
  if (kind !== undefined && !(WALK_KINDS as readonly string[]).includes(kind)) return `"${kind}" is not a kind of walk`
  if (settings !== undefined) {
    const problem = settingsProblem(settings)
    if (problem) return problem
    if (plan.slopeLimit.deg !== settings.maxSlopeDeg) {
      return `The slope limit (${plan.slopeLimit.deg}°) is not the settings' max slope (${settings.maxSlopeDeg}°)`
    }
  }
  if (samples === undefined) return null
  if (settings === undefined) return 'Samples need the settings they are counted against'
  if (samples.length > settings.samples) return `${samples.length} samples are more than the settings' ${settings.samples}`
  const ids = new Set<string>()
  const orders = new Set<number>()
  let dwell = 0
  for (const s of samples) {
    if (s.id === '') return 'A sample has no id'
    if (ids.has(s.id)) return 'Two samples share an id'
    ids.add(s.id)
    if (!Number.isInteger(s.order) || s.order < 1 || s.order > samples.length) {
      return `Sample ${s.id}'s order ${s.order} is not one of 1 to ${samples.length}`
    }
    if (orders.has(s.order)) return `Two samples share order ${s.order}`
    orders.add(s.order)
    if (!(Number.isFinite(s.dwellMin) && s.dwellMin >= 0)) return `Sample ${s.id}'s ${s.dwellMin} minutes is not a time`
    dwell += s.dwellMin
    const check = validateCoordinate(s.coordinate)
    if (!check.ok) return `Sample ${s.id} is not at a valid coordinate (${check.reason})`
    if (!onPlanPath(plan, s.coordinate)) {
      return `Sample ${s.id} is not on the walk's path (more than ${SAMPLE_ON_PATH_TOLERANCE_M} m from it)`
    }
  }
  if (dwell > settings.durationMin) {
    return `The samples take ${dwell} min, more than the settings' ${settings.durationMin} min`
  }
  return null
}

function settingsProblem(s: MissionSettings): string | null {
  if (!(s.maxSlopeDeg > 0 && s.maxSlopeDeg < 90)) return `A max slope of ${s.maxSlopeDeg}° is not a slope`
  if (!(Number.isInteger(s.samples) && s.samples >= 0)) return `${s.samples} is not a number of samples`
  if (!(Number.isFinite(s.energyKcal) && s.energyKcal > 0)) return `${s.energyKcal} kcal is not an energy budget`
  if (!(Number.isFinite(s.durationMin) && s.durationMin > 0)) return `${s.durationMin} min is not a duration`
  return null
}

/**
 * Whether `p` lies within SAMPLE_ON_PATH_TOLERANCE_M of the walk: each leg's
 * DERIVED path, or the straight line between its stops where the path is
 * UNAVAILABLE (a leg is that line, `WalkLeg`). Distances on a local flat
 * frame around `p`, plenty at a metre over a walk's few kilometres.
 */
function onPlanPath(plan: WalkPlan, p: MarsCoordinate): boolean {
  const toleranceKm = SAMPLE_ON_PATH_TOLERANCE_M / 1000
  for (let i = 0; i < plan.legs.length; i++) {
    const path = plan.legs[i].path
    const line =
      path.classification !== 'UNAVAILABLE' && path.value.length >= 2
        ? path.value
        : [plan.stops[i].coordinate, plan.stops[i + 1].coordinate]
    for (let j = 0; j + 1 < line.length; j++) {
      if (segmentDistanceKm(p, line[j], line[j + 1]) <= toleranceKm) return true
    }
  }
  return false
}

/** Km from `p` to the segment `a`–`b`, on a flat frame centred on `p`; longitudes wrap across 0/360°E. */
function segmentDistanceKm(p: MarsCoordinate, a: MarsCoordinate, b: MarsCoordinate): number {
  const kmPerDeg = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
  const cosLat = Math.cos((p.latitude * Math.PI) / 180)
  const local = (c: MarsCoordinate): [number, number] => {
    let dLon = c.longitudeEast - p.longitudeEast
    if (dLon > 180) dLon -= 360
    else if (dLon < -180) dLon += 360
    return [dLon * cosLat * kmPerDeg, (c.latitude - p.latitude) * kmPerDeg]
  }
  const [ax, ay] = local(a)
  const [bx, by] = local(b)
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2))
  return Math.hypot(ax + t * dx, ay + t * dy)
}
