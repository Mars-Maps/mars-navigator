import {
  MARS_MEAN_RADIUS_KM,
  derived,
  official,
  unavailable,
  validateCoordinate,
  type Classified,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type ScienceGoal,
  type WalkStop,
} from '../../domain'
import { surfaceDistanceKm } from './routeDistance'

/**
 * Science goals: the astronaut picks what the walk is for, and gets
 * candidate stops on the geologic units of USGS SIM 3464 that serve it.
 *
 * The goal → unit table below is reviewed by hand, not worked out at run
 * time. Each goal's units were chosen by their interpretation in the map
 * (the Geologic Units layer of the SIM 3464 feature service, read
 * 2026-10-31), and each reason quotes that interpretation verbatim. Unit
 * names are spelled as the map spells them, because they are matched
 * exactly against what the units adapter reads. Where the map spells
 * one unit two ways, both are listed: the crater rim unit (symbol cr) is
 * "Crater rim unit" on 64 polygons and "Crater riim unit" on 1 (read
 * 2026-11-01), and a goal that named only the typo would miss the rim.
 * `tests/fixtures/sim3464UnitNames.ts` records the map's names.
 */

/**
 * How far from the start a stop may be, km. A project choice, not a cited
 * figure: no source read for the app gives a suited walking range on Mars.
 */
export const DEFAULT_MAX_WALK_KM = 5

/** How many stops after the start, by default. A project choice. */
export const DEFAULT_MAX_STOPS = 3

/** How far inside its unit a stop is put, so it never sits on a contact. */
const STOP_INSET_KM = 0.05

const SIM_3464_CITATION =
  'Sun, V.Z., and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: U.S. Geological Survey Scientific Investigations Map 3464, https://doi.org/10.3133/sim3464'

// The table is SCIENCE_GOALS below; the number stays here, not in the words the app shows.
const GOAL_METHOD = `Goal → unit table reviewed in the project's code: units chosen by their interpretation in ${SIM_3464_CITATION}, quoted verbatim`

export const SCIENCE_GOALS: readonly ScienceGoal[] = [
  {
    id: 'delta-deposits',
    label: 'Delta deposits',
    unitNames: ['Jezero fan 1 unit', 'Jezero fan 2 unit'],
    reason: derived(
      'SIM 3464 reads Jezero fan 2 as "Deltaic fan deposits emplaced during the Late Noachian to Early Hesperian" and Jezero fan 1 as a "Degraded deltaic or lacustrine deposit"',
      GOAL_METHOD,
    ),
  },
  {
    id: 'crater-floor',
    label: 'Crater floor',
    unitNames: ['Jezero floor unit', 'Lower etched unit'],
    reason: derived(
      'SIM 3464 reads the Jezero floor unit as "Volcanic ash or eolian airfall deposit that drapes underlying topography" that "May have been modified by subsequent lacustrine activity", and the Lower etched unit as "Either deposited into an existing lake within Jezero or subsequently altered by later lacustrine processes"',
      GOAL_METHOD,
    ),
  },
  {
    id: 'ancient-crust',
    label: 'Ancient crust',
    unitNames: ['Nili Planum 1 unit', 'Crater rim unit', 'Crater riim unit'],
    reason: derived(
      'SIM 3464 reads Nili Planum 1 as "Crustal rocks of undetermined origin, representing pre-Isidis crust, syn-Isidis impact products, and syn-Jezero impact products", and says outcrops of the crater rim unit "by the western and southern Jezero crater walls contain megabreccia"',
      GOAL_METHOD,
    ),
  },
]

/** A point in a local plane around the start: km east and km north. */
export interface Xy {
  x: number
  y: number
}

/**
 * The start, then stops inside the goal's units within `maxWalkKm` of it,
 * in walking order.
 *
 * One candidate per matching polygon: the point of the polygon nearest the
 * start, moved STOP_INSET_KM inside it. The `maxStops` nearest are kept and
 * ordered nearest-neighbour from the start. A polygon the start already
 * stands in gives no stop of its own. Geometry is worked in a plane tangent
 * at the start (equirectangular, R = MARS_MEAN_RADIUS_KM), good to well under
 * 1% over a walk of a few km; the range uses the haversine distance.
 *
 * Throws when the start is not a valid coordinate or is too near a pole for
 * the plane; the shell turns that into a reason.
 */
export function candidateStops(
  goal: ScienceGoal,
  start: MarsCoordinate,
  units: readonly GeologicUnitArea[],
  options: { maxWalkKm?: number; maxStops?: number } = {},
): WalkStop[] {
  const check = validateCoordinate(start)
  if (!check.ok) throw new Error(`The start is not a valid coordinate (${check.reason})`)
  if (Math.abs(start.latitude) > 85) throw new Error('The start is too near a pole to plan stops on a flat plane')
  const maxWalkKm = options.maxWalkKm ?? DEFAULT_MAX_WALK_KM
  const maxStops = options.maxStops ?? DEFAULT_MAX_STOPS

  const plane = tangentPlane(start)
  const areas = units
    .map((area) => ({ unit: area.unit, rings: area.rings.map((r) => r.map(plane.project)).filter((r) => r.length >= 3) }))
    .filter((a) => a.rings.length > 0)
  const origin: Xy = { x: 0, y: 0 }
  // The first polygon the start lies in. A geologic map partitions the
  // ground, so at most one unit polygon contains a point (holes cut out).
  const under = areas.find((a) => insideRings(origin, a.rings))

  const wanted = new Set(goal.unitNames)
  const candidates: { unit: GeologicUnit; xy: Xy; km: number }[] = []
  for (const area of areas) {
    if (!wanted.has(area.unit.name) || area === under) continue
    const xy = pointInside(area.rings)
    if (xy === null) continue
    const km = surfaceDistanceKm(start, plane.unproject(xy))
    if (km <= maxWalkKm) candidates.push({ unit: area.unit, xy, km })
  }
  candidates.sort((a, b) => a.km - b.km)

  const stops: WalkStop[] = [
    {
      id: `${goal.id}-1`,
      label: 'Start',
      coordinate: start,
      unit: under
        ? official(under.unit, under.unit.map.citation)
        : unavailable(
            units.length === 0
              ? 'No geologic unit was read for the walk'
              : 'No unit of the geologic map covers the start',
          ),
      reason: derived('Where the walk starts', 'The start chosen in the app; not picked by the planner'),
    },
  ]
  for (const c of nearestNeighbourOrder(candidates.slice(0, Math.max(0, maxStops)))) {
    const n = stops.length + 1
    stops.push({
      id: `${goal.id}-${n}`,
      label: `${stopName(n)} · ${c.unit.name}`,
      coordinate: plane.unproject(c.xy),
      unit: official(c.unit, c.unit.map.citation),
      reason: stopReason(goal, c.unit, maxWalkKm),
    })
  }
  return stops
}

/**
 * The stops with each one's unit as the map answers for that exact point,
 * `reads[i]` for `stops[i]`. `candidateStops` works from simplified polygons
 * that carry no text, so this is where a stop gets the map's own words.
 *
 * - The start takes its read as it is: a contact or a failed read is
 *   UNAVAILABLE, since a simplified polygon must not name the unit underfoot.
 * - A stop whose read names another unit is dropped, as it is not on the
 *   goal's ground after all.
 * - A stop whose read gives no unit (a failed read, a contact, no map there)
 *   stays, as a failed service is no finding about the ground, but with that
 *   read as its unit and a reason saying so: a simplified polygon alone never
 *   makes it OFFICIAL.
 */
export function confirmStops(
  goal: ScienceGoal,
  stops: readonly WalkStop[],
  reads: readonly Classified<GeologicUnit>[],
  maxWalkKm: number = DEFAULT_MAX_WALK_KM,
  /** The reason for a stop the read confirms; `stopReason` for a stop chosen as `candidateStops` chooses. */
  reasonFor: (unit: GeologicUnit, stop: WalkStop) => Classified<string> = (unit) => stopReason(goal, unit, maxWalkKm),
): WalkStop[] {
  const wanted = new Set(goal.unitNames)
  const out: WalkStop[] = []
  stops.forEach((stop, i) => {
    const read = reads[i]
    if (i === 0) {
      out.push({ ...stop, unit: read })
      return
    }
    if (read.classification === 'UNAVAILABLE') {
      out.push(renumbered(goal, stop, read, unconfirmedReason(goal, stop), out.length + 1))
      return
    }
    if (!wanted.has(read.value.name)) return
    out.push(renumbered(goal, stop, read, reasonFor(read.value, stop), out.length + 1))
  })
  return out
}

function renumbered(goal: ScienceGoal, stop: WalkStop, unit: Classified<GeologicUnit>, reason: Classified<string>, n: number): WalkStop {
  const name = unit.classification === 'UNAVAILABLE' ? null : unit.value.name
  return { ...stop, id: `${goal.id}-${n}`, label: name === null ? stopName(n) : `${stopName(n)} · ${name}`, unit, reason }
}

/** What the walk's last stop is called: the landing site, come back to. */
export const RETURN_STOP_LABEL = 'Return · landing site'

/** Why the walk's last stop is there, and how the way to it is treated. */
export const RETURN_STOP_REASON = derived(
  'The landing site again: the walk ends where it began, so the way back is in its distance, time and energy',
  'The straight line back to the landing site from the last place visited, walked, costed and checked against the mission settings as every other leg is. The places visited are chosen so that the walk out and the way back fit the settings together',
)

/**
 * The stop that closes a walk: back at `start`, the walk's first stop, as
 * its `n`th point (1-based, as the ids count). Every walk of Plan a walk
 * ends with one, so the time and the energy it is checked on are those of
 * going out and of coming back.
 */
export function returnStop(goal: ScienceGoal, n: number, start: WalkStop): WalkStop {
  return { id: `${goal.id}-${n}`, label: RETURN_STOP_LABEL, coordinate: start.coordinate, unit: start.unit, reason: RETURN_STOP_REASON }
}

/**
 * The name of the walk's `n`th point, 1-based, the start being the first:
 * the start is "Start", so the stops after it count from 1, as the
 * search bar's stops do. Only the name: the ids keep counting the start.
 */
export function stopName(n: number): string {
  return `Stop ${n - 1}`
}

/** Why a stop whose unit could not be confirmed is still on the walk: the polygon that chose it, and no more. */
function unconfirmedReason(goal: ScienceGoal, stop: WalkStop): Classified<string> {
  const polygon = stop.unit.classification === 'UNAVAILABLE' ? null : stop.unit.value
  const chosen = polygon?.name ?? 'A unit'
  const map = polygon?.map.id ?? 'geologic map'
  return derived(
    `${chosen}, a unit the goal "${goal.label}" visits, going by the map's simplified polygons; the unit at this exact point was not confirmed`,
    `Chosen from the ${map} polygons of the units the goal "${goal.label}" visits, as the service simplifies them, to within about 30 m; the read for this point gave no unit, so this stop's own unit is UNAVAILABLE`,
  )
}

/** Why one stop serves the goal: the unit's own interpretation, or failing that its description, quoted. */
export function stopReason(
  goal: ScienceGoal,
  unit: GeologicUnit,
  maxWalkKm: number,
  /** How the stop was placed and what bounds the walk; `candidateStops`' own by default. */
  where: { placement?: string; reachBasis?: string } = {},
): Classified<string> {
  const quote = firstSentence(unit.interpretation) ?? firstSentence(unit.description)
  const placement = where.placement ?? `the point of that unit's polygon nearest the start, ${STOP_INSET_KM * 1000} m inside it`
  const basis = where.reachBasis ?? 'a project choice, not a cited range'
  const method = `The ${unit.map.id} unit under the stop is one the goal "${goal.label}" visits (reviewed table, scienceGoals.ts); the stop is ${placement}, within ${maxWalkKm.toFixed(2)} km of the start (${basis})`
  return derived(quote ? `${unit.name}: "${quote}"` : `${unit.name}, a unit the goal "${goal.label}" visits`, method)
}

/**
 * The text up to its first full stop followed by a new sentence, or all of
 * it. A stop that ends an abbreviation the map's text uses ("e.g.", "Fig.",
 * "et al.", "etc.", "ca.", "cf.", "vs.") does not end the sentence.
 */
function firstSentence(text: string | undefined): string | null {
  const t = text?.trim()
  if (!t) return null
  const m = /^(.+?(?<!\b(?:e\.g|i\.e|etc|[Ff]ig|et al|ca|cf|vs|approx))\.)\s+[A-Z(]/.exec(t)
  return m ? m[1] : t
}

/** Start at the origin, then always walk to the nearest candidate left. */
function nearestNeighbourOrder<T extends { xy: Xy }>(items: readonly T[]): T[] {
  const left = [...items]
  const order: T[] = []
  let at: Xy = { x: 0, y: 0 }
  while (left.length > 0) {
    let best = 0
    for (let i = 1; i < left.length; i++) {
      if (dist(at, left[i].xy) < dist(at, left[best].xy)) best = i
    }
    const [next] = left.splice(best, 1)
    order.push(next)
    at = next.xy
  }
  return order
}

export function tangentPlane(origin: MarsCoordinate) {
  const rad = Math.PI / 180
  const kmPerDegLat = MARS_MEAN_RADIUS_KM * rad
  const kmPerDegLon = kmPerDegLat * Math.cos(origin.latitude * rad)
  return {
    project: (c: MarsCoordinate): Xy => {
      // Wrap to ±180° so a polygon across 0/360°E stays in one piece.
      const dLon = ((((c.longitudeEast - origin.longitudeEast) % 360) + 540) % 360) - 180
      return { x: dLon * kmPerDegLon, y: (c.latitude - origin.latitude) * kmPerDegLat }
    },
    unproject: ({ x, y }: Xy): MarsCoordinate => ({
      latitude: origin.latitude + y / kmPerDegLat,
      longitudeEast: (((origin.longitudeEast + x / kmPerDegLon) % 360) + 360) % 360,
    }),
  }
}

const dist = (a: Xy, b: Xy) => Math.hypot(a.x - b.x, a.y - b.y)

/** Even-odd rule over every ring, so holes cut out whatever the ring order or winding. */
export function insideRings(p: Xy, rings: readonly Xy[][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

/**
 * A point inside the polygon near the origin: the nearest boundary point,
 * stepped STOP_INSET_KM away from the origin or to either side of its edge,
 * whichever lands inside; failing those, the middle of the widest span
 * across the polygon's mid-height. Null for a polygon with no inside.
 */
function pointInside(rings: readonly Xy[][]): Xy | null {
  let best: { p: Xy; edge: Xy; d: number } | null = null
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = nearestOnSegment({ x: 0, y: 0 }, ring[j], ring[i])
      const d = Math.hypot(p.x, p.y)
      if (best === null || d < best.d) best = { p, edge: { x: ring[i].x - ring[j].x, y: ring[i].y - ring[j].y }, d }
    }
  }
  if (best === null) return null

  const steps: Xy[] = []
  if (best.d > 0) steps.push({ x: best.p.x / best.d, y: best.p.y / best.d })
  const len = Math.hypot(best.edge.x, best.edge.y)
  if (len > 0) {
    steps.push({ x: -best.edge.y / len, y: best.edge.x / len }, { x: best.edge.y / len, y: -best.edge.x / len })
  }
  for (const s of steps) {
    const q = { x: best.p.x + s.x * STOP_INSET_KM, y: best.p.y + s.y * STOP_INSET_KM }
    if (insideRings(q, rings)) return q
  }
  return midSpan(rings)
}

function nearestOnSegment(p: Xy, a: Xy, b: Xy): Xy {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** The middle of the widest inside span along the horizontal line through the outer ring's mid-height. */
function midSpan(rings: readonly Xy[][]): Xy | null {
  const ys = rings[0].map((p) => p.y)
  const y = (Math.min(...ys) + Math.max(...ys)) / 2
  const xs: number[] = []
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
    }
  }
  xs.sort((a, b) => a - b)
  let best: Xy | null = null
  let width = 0
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) {
      width = xs[i + 1] - xs[i]
      best = { x: (xs[i] + xs[i + 1]) / 2, y }
    }
  }
  return best
}
