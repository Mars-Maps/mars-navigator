import {
  derived,
  official,
  unavailable,
  type Classified,
  type GeologicUnit,
  type MarsCoordinate,
  type WalkKind,
  type WalkStop,
} from '../domain'
import type { PlaceName } from '../data/adapters/PlaceNamesAdapter'
import type { ElevationProfile } from '../features/route-analysis/elevationProfile'
import { surfaceDistanceKm } from '../features/route-analysis/routeDistance'
import { ROVER_CHECK_GOAL, fitRoverCheck, roverCheckPath, roverCheckStops } from '../features/route-analysis/roverCheckWalk'
import { DEFAULT_MAX_WALK_KM } from '../features/route-analysis/scienceGoals'
import { TRANSECT_GOAL, transectLine, type NamedCrater } from '../features/route-analysis/transectLine'
import { confirmTransectSamples, confirmTransectStops, transectWalk } from '../features/route-analysis/transectWalk'
import type { DraftWalk } from './planWalks'
import { landingSiteProblem, type WalkPlanner, type WalkPlannerSources } from './walkPlanner'

/**
 * Each kind of walk's draft for `planWalks`: the data each walk's
 * own module needs is read here, so the modules stay pure. The transect
 * and the rover check place and fit their own samples; the
 * flat-bedrock walk gives its stops and sample places.
 */

/** What the drafts read beyond the planner's sources. */
export interface WalkDraftSources extends Pick<WalkPlannerSources, 'site' | 'units' | 'unitAt' | 'traverse'> {
  /** The elevation profile along a path, as `planWalks` reads it. */
  profile: (path: readonly MarsCoordinate[], signal: AbortSignal) => Promise<Classified<ElevationProfile>>
  /** The site's crater and the named craters near it, from the place names; UNAVAILABLE where they cannot be read. */
  crater: (signal: AbortSignal) => Promise<Classified<NamedCrater>>
}

export function walkDrafts(planner: WalkPlanner, sources: WalkDraftSources): Record<WalkKind, DraftWalk> {
  const { site } = sources
  const offSheet = (start: MarsCoordinate) => landingSiteProblem(start, site)
  const unitsAt = (points: readonly MarsCoordinate[], signal: AbortSignal) =>
    Promise.all(points.map((p) => sources.unitAt(p, signal)))

  return {
    // Walk 1: its stops within the settings, confirmed on the map, and its sample places.
    'flat-bedrock': (start, settings, signal) => planner.flatBedrock(start, settings, signal),

    'rim-to-floor': async (start, settings, signal) => {
      const problem = offSheet(start)
      if (problem !== null) return unavailable(problem)
      // The whole sheet: a box round a site east of the fan holds no rim unit.
      const [areas, crater] = await Promise.all([sources.units(site.bounds, signal), sources.crater(signal)])
      if (areas.classification === 'UNAVAILABLE') return unavailable(`The map's units could not be read: ${areas.reason}`)
      // Without the place names the line runs from the nearest rim outcrop and says so.
      const line = transectLine(start, areas.value, DEFAULT_MAX_WALK_KM, crater.classification === 'UNAVAILABLE' ? undefined : crater.value)
      if (line.classification === 'UNAVAILABLE') return line
      const profile = await sources.profile(line.value.path, signal)
      if (profile.classification === 'UNAVAILABLE') return unavailable(`The heights along the transect could not be read: ${profile.reason}`)
      const walk = transectWalk(line.value, profile.value, areas.value, settings)
      if (walk.classification === 'UNAVAILABLE') return walk
      const { stops, samples, notes, composition } = walk.value
      // The polygons are simplified: each stop and sample gets the map's read of its exact point.
      const [stopReads, sampleReads] = await Promise.all([
        unitsAt(stops.map((s) => s.coordinate), signal),
        unitsAt(samples.map((s) => s.sample.coordinate), signal),
      ])
      const confirmed = confirmTransectSamples(samples, sampleReads)
      return derived(
        {
          goal: TRANSECT_GOAL,
          stops: confirmTransectStops(stops, stopReads),
          samples: confirmed.map((s) => s.sample),
          notes: [...notes, ...(composition.classification === 'UNAVAILABLE' ? [composition.reason] : [])],
        },
        methodOf(walk),
      )
    },

    'rover-check': async (start, settings, signal) => {
      const problem = offSheet(start)
      if (problem !== null) return unavailable(problem)
      const traverse = await sources
        .traverse(signal)
        .catch((e: unknown) => unavailable<never>(e instanceof Error ? e.message : String(e)))
      const candidate = roverCheckStops(start, traverse, settings)
      if (candidate.classification === 'UNAVAILABLE') return candidate
      const profile = await sources.profile(roverCheckPath(candidate.value), signal)
      if (profile.classification === 'UNAVAILABLE') return unavailable(`The heights to the waypoints could not be read: ${profile.reason}`)
      const walk = fitRoverCheck(candidate.value, profile.value, settings)
      if (walk.classification === 'UNAVAILABLE') return walk
      const reads = await unitsAt(walk.value.path, signal)
      const stops: WalkStop[] = walk.value.path.map((coordinate, i) => {
        const waypoint = i === 0 ? null : walk.value.stops[i - 1]
        return {
          id: `${ROVER_CHECK_GOAL.id}-${i + 1}`,
          label: waypoint ? `Stop ${i} · sol ${waypoint.sol}` : 'Start',
          coordinate,
          unit: reads[i] ?? unitNotRead,
          reason: waypoint
            ? official(
                `Perseverance was here on sol ${waypoint.sol} (site ${waypoint.rmc.site}, drive ${waypoint.rmc.drive})`,
                candidate.value.source,
              )
            : derived('Where the walk starts', 'The start chosen in the app; not picked by the planner'),
        }
      })
      const { cut } = walk.value
      const left = `${cut.count} more waypoint${cut.count === 1 ? ' was' : 's were'} left off`
      const notes =
        cut.count === 0
          ? []
          : cut.unchecked
            ? [`${left}: the walk to the next could not be checked (${cut.unchecked.limits.join(', ')} not known): ${cut.unchecked.reason}.`]
            : [`${left}: the next would break the ${cut.limit ?? 'settings'} limit.`]
      return derived({ goal: ROVER_CHECK_GOAL, stops, samples: walk.value.samples, notes }, methodOf(walk))
    },
  }
}

const unitNotRead = unavailable<GeologicUnit>('The map was not read at this stop')

function methodOf(c: Classified<unknown>): string {
  return c.classification === 'UNAVAILABLE' ? c.reason : c.classification === 'DERIVED' ? c.method : c.source
}

/**
 * How far from the crater's centre, in its diameters, another named crater
 * counts as near it, so the transect never reads that crater's rim as the
 * main one's: a project choice, wide enough for the craters on its rim and
 * just outside it.
 */
export const NEAR_CRATER_DIAMETERS = 1.5

/**
 * The crater named `name` and the named craters near it, as the transect
 * wants them, from the Gazetteer's place names. UNAVAILABLE where
 * the name is not a crater with a diameter.
 */
export function craterFromNames(names: readonly PlaceName[], name: string, source: string): Classified<NamedCrater> {
  const crater = names.find((n) => n.name === name && n.type === 'Crater')
  if (!crater || crater.diameterKm === null) return unavailable(`The place names give no crater ${name} with a diameter`)
  const reachKm = crater.diameterKm * NEAR_CRATER_DIAMETERS
  const others = names
    .filter((n) => n !== crater && n.type === 'Crater' && surfaceDistanceKm(crater.coordinate, n.coordinate) <= reachKm)
    .flatMap((n) => (n.diameterKm === null ? [] : [{ centre: n.coordinate, diameterKm: n.diameterKm }]))
  return official({ name, centre: crater.coordinate, diameterKm: crater.diameterKm, source, others }, source)
}
