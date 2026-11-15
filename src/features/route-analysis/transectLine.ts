import {
  derived,
  unavailable,
  type Classified,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type ScienceGoal,
} from '../../domain'
import { pointAlong } from './elevationProfile'
import { surfaceDistanceKm } from './routeDistance'
import { DEFAULT_MAX_WALK_KM, candidateStops, insideRings, tangentPlane } from './scienceGoals'

/**
 * The line of walk 2 of Plan a walk: from a crater rim outcrop,
 * through the landing site, to the floor units. Pure; the walk along it is
 * `transectWalk.ts`. It shows where the mapped units change and says
 * nothing about minerals: the project has no mineral dataset.
 */

/**
 * The map's crater rim unit, both ways SIM 3464 spells it (`scienceGoals`).
 * The map uses it for every mapped crater's rim, so the nearest outcrop can
 * be a smaller crater's inside Jezero, not Jezero's own; the method says so.
 */
export const TRANSECT_RIM_UNITS: readonly string[] = ['Crater rim unit', 'Crater riim unit']

/** The floor units the transect ends on: the crater-floor goal's pair (`SCIENCE_GOALS`). */
export const TRANSECT_FLOOR_UNITS: readonly string[] = ['Jezero floor unit', 'Lower etched unit']

/**
 * How far along the line from where it crosses a contact a sample is put,
 * km: a stop's inset in `scienceGoals`. Along the line only: a contact that
 * runs beside the line can be nearer than this.
 */
export const SAMPLE_INSET_KM = 0.05

/** How far past the nearest point of an end's unit the line runs, km: room for one sample inset from both sides. */
const END_OVERRUN_KM = 3 * SAMPLE_INSET_KM

/** Why the walk gives no composition: said wherever the walk is described. */
export const TRANSECT_COMPOSITION: Classified<string> = unavailable(
  'The project has no mineral dataset, so the composition of the ground is not known here; the walk shows where the geologic map\'s units change',
)

const POLYGONS = 'Units from the map\'s polygons as the service simplifies them, to within about 30 m'

const NEAREST_METHOD = `A transect from the nearest outcrop of the geologic map's crater rim unit, through the landing site, toward the floor units; the map uses that unit for every mapped crater's rim, so the outcrop may be a smaller crater's. ${POLYGONS}`

/** The goal the plan carries: the units the transect runs between. Its words claim no mineral. */
export const TRANSECT_GOAL: ScienceGoal = {
  id: 'rim-to-floor',
  label: 'Rim to floor',
  unitNames: [...TRANSECT_RIM_UNITS, ...TRANSECT_FLOOR_UNITS],
  reason: derived(
    'How the mapped ground changes from a crater rim to the crater floor: a sample on each geologic unit the line crosses. Composition is not known; no mineral dataset is read',
    `A transect from an outcrop of the geologic map's crater rim unit, through the landing site, toward the floor units: the main crater's own rim where an outcrop of it is within reach, else the nearest outcrop, which may be a smaller crater's. ${POLYGONS}`,
  ),
}

export const TRANSECT_REASONS = {
  noRim: 'The geologic map has no crater rim unit around this landing site',
  noLine: 'The landing site stands on the crater rim unit and no floor unit is within reach, so there is no line to walk',
  noProfile: 'The heights along the transect do not match its line',
  slope: (deg: number) => `The ground beside the landing site along the transect is over the ${deg}° slope limit or has no height, so none of it can be walked`,
  oneUnit: (name: string | null) =>
    `The transect crosses no contact within the walk's limits: ${name === null ? 'no mapped unit' : `only ${name}`} has room for a sample along the part that can be walked`,
  fewSamples: 'The settings ask for fewer than two samples, and a transect needs one on each side of a contact',
} as const

/**
 * The crater the walk is in, as the Gazetteer gives it, so its own rim can
 * be told from the rims of the smaller craters the map draws with the same
 * unit. Handed in by the shell: a feature reads no data source itself.
 */
export interface NamedCrater {
  name: string
  centre: MarsCoordinate
  diameterKm: number
  /** The citation of the centre and the diameter. */
  source: string
  /** Other named craters around it, whose rims are theirs and not this crater's. */
  others?: readonly { centre: MarsCoordinate; diameterKm: number }[]
}

/**
 * How far from the crater's centre, in radii, an outcrop of the rim unit
 * may lie on average and still be read as that crater's rim or wall: a
 * project choice, wide enough for the wall inside the crest and the flank
 * outside it. Not a published definition of a rim.
 */
export const OWN_RIM_BAND = { from: 0.7, to: 1.2 } as const

/**
 * Whether an outcrop of the rim unit is `crater`'s own: its outer ring in
 * the band about the centre on average, and its middle not at another
 * named crater. Worked in a plane at the centre, so an outcrop across
 * 0/360°E is one piece.
 */
export function isOwnRim(area: GeologicUnitArea, crater: NamedCrater): boolean {
  const plane = tangentPlane(crater.centre)
  const points = (area.rings[0] ?? []).map(plane.project)
  if (points.length === 0) return false
  const middle = plane.unproject({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  })
  if ((crater.others ?? []).some((o) => surfaceDistanceKm(o.centre, middle) <= o.diameterKm)) return false
  const radii = points.reduce((sum, p) => sum + Math.hypot(p.x, p.y), 0) / points.length / (crater.diameterKm / 2)
  return radii >= OWN_RIM_BAND.from && radii <= OWN_RIM_BAND.to
}

/** How the line's rim was chosen when it is the named crater's own. */
function ownRimMethod(crater: NamedCrater): string {
  return `A transect from the nearest outcrop of ${crater.name} crater's own rim, through the landing site, toward the floor units. An outcrop of the geologic map's crater rim unit is read as ${crater.name}'s when it lies on average ${OWN_RIM_BAND.from} to ${OWN_RIM_BAND.to} of the crater's radius from its centre (${crater.diameterKm} km across; ${crater.source}) and not at another named crater; the band is a project choice, not a published definition of the rim. ${POLYGONS}`
}

/** The line of the transect, before any height is read. */
export interface TransectLine {
  /** Rim side first: the rim-side end, the landing site, then the floor end where the line has one. */
  path: MarsCoordinate[]
  /** Index of the landing site in `path`: 0 when it stands on the rim unit, else 1. */
  startIndex: number
  /** Km from the landing site to the rim-side end. */
  outKm: number
  /** False where the rim unit is farther than the reach: the line stops short of it. */
  reachesRim: boolean
  /** Km from the landing site to the rim outcrop; 0 when it stands on one. */
  rimKm: number
  /** How the line meets the floor units. */
  floor: 'under-start' | 'end' | 'toward-rim' | 'out-of-reach'
  /** The unit under the landing site, by the map's polygons; null on unmapped ground. */
  startUnit: GeologicUnit | null
  /** Whose rim the line runs from: the named crater's own, else null for an outcrop that may be a smaller crater's. */
  rimOf: string | null
  /** How the line was drawn; the walk along it carries this on. */
  method: string
}

/**
 * The transect's line from `start`. `reachKm` is how far from the landing
 * site either end may be (a project choice, `DEFAULT_MAX_WALK_KM`): a rim
 * farther than that gives the part of the line that fits. With `crater`,
 * the line runs from that crater's own rim when an outcrop of it is within
 * reach, and from the nearest outcrop of the rim unit otherwise.
 *
 * Off the floor units, the line goes on past the landing site to the
 * nearest one, unless that lies on the rim's side of the site: the line
 * would double back on itself, so it ends at the site instead. Both ends
 * run a little past the nearest point of their unit, so a sample has room
 * to stand on it. UNAVAILABLE with the reason for a start that is not a
 * valid coordinate or is too near a pole.
 */
export function transectLine(
  start: MarsCoordinate,
  areas: readonly GeologicUnitArea[],
  reachKm = DEFAULT_MAX_WALK_KM,
  crater?: NamedCrater,
): Classified<TransectLine> {
  const nearest = (unitNames: readonly string[], maxWalkKm: number, from: readonly GeologicUnitArea[] = areas) =>
    candidateStops({ ...TRANSECT_GOAL, unitNames }, start, from, { maxWalkKm, maxStops: 1 })
  const isRim = (a: GeologicUnitArea) => TRANSECT_RIM_UNITS.includes(a.unit.name)
  let startStop
  try {
    startStop = nearest(TRANSECT_RIM_UNITS, 0)[0]
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e))
  }
  const under = startStop.unit.classification === 'UNAVAILABLE' ? null : startStop.unit.value
  const onRim = under !== null && TRANSECT_RIM_UNITS.includes(under.name)
  const onFloor = under !== null && TRANSECT_FLOOR_UNITS.includes(under.name)
  const plane = tangentPlane(start)

  // The rim the line runs from, and whether it is the named crater's own.
  let rim = start
  let own = false
  if (onRim) {
    const underArea = areas.find((a) => isRim(a) && insideRings({ x: 0, y: 0 }, a.rings.map((r) => r.map(plane.project))))
    own = crater !== undefined && underArea !== undefined && isOwnRim(underArea, crater)
  } else {
    const ownStop = crater ? nearest(TRANSECT_RIM_UNITS, reachKm, areas.filter((a) => !isRim(a) || isOwnRim(a, crater)))[1] : undefined
    const stop = ownStop ?? nearest(TRANSECT_RIM_UNITS, Number.POSITIVE_INFINITY)[1]
    if (stop === undefined) return unavailable(TRANSECT_REASONS.noRim)
    rim = stop.coordinate
    own = ownStop !== undefined
  }
  const rimKm = onRim ? 0 : surfaceDistanceKm(start, rim)
  const outKm = onRim ? 0 : Math.min(rimKm + END_OVERRUN_KM, reachKm)
  const outer = onRim ? start : pointAlong(start, rim, outKm / rimKm)

  let floor: TransectLine['floor'] = 'under-start'
  let floorEnd: MarsCoordinate | null = null
  if (!onFloor) {
    const stop = nearest(TRANSECT_FLOOR_UNITS, reachKm)[1]
    if (stop === undefined) floor = 'out-of-reach'
    else {
      const to = plane.project(stop.coordinate)
      const out = plane.project(outer)
      if (!onRim && to.x * out.x + to.y * out.y > 0) floor = 'toward-rim'
      else {
        const km = surfaceDistanceKm(start, stop.coordinate)
        floorEnd = pointAlong(start, stop.coordinate, Math.min(km + END_OVERRUN_KM, reachKm) / km)
        floor = 'end'
      }
    }
  }
  if (onRim && floorEnd === null) return unavailable(TRANSECT_REASONS.noLine)

  const method = `${own && crater ? ownRimMethod(crater) : NEAREST_METHOD}. Neither end more than ${reachKm} km from the landing site (a project choice, not a cited range)`
  return derived(
    {
      path: [...(onRim ? [] : [outer]), start, ...(floorEnd === null ? [] : [floorEnd])],
      startIndex: onRim ? 0 : 1,
      outKm,
      reachesRim: rimKm <= reachKm,
      rimKm,
      floor,
      startUnit: under,
      rimOf: own && crater ? crater.name : null,
      method,
    },
    method,
  )
}
