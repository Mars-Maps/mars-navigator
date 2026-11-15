import {
  derived,
  insideBounds,
  unavailable,
  type GeologicFeatures,
  type Hazard,
  type MarsCoordinate,
  type RouteStrategy,
  type SiteBounds,
} from '../../domain'
import type { HazardDetector } from './hazards'
import { CRATER_NEAR_KM, OBSTACLE_KINDS, firstInside, isKind, named, nearestOnLeg, segmentCrossing } from './mappedObstacles'
import { insideRings, tangentPlane } from './scienceGoals'
import type { SearchedLeg } from './terrainSearch'

/**
 * What the geologic map marks along a searched route's path. Its own
 * module, read when the first route is searched: the route strategies load
 * with the app, and this is not needed until a route exists.
 */

/**
 * Whether the straight stretch a → b has any point in `bounds`: an end
 * inside it, or the stretch crossing one of its four edges (both ends can be
 * outside a sheet whose corner the stretch cuts). In degrees, where the path
 * is straight and the sheet a rectangle; not for a stretch across 0/360°E,
 * which no sheet with edges here reaches.
 */
export function stretchMeetsBounds(a: MarsCoordinate, b: MarsCoordinate, bounds: SiteBounds): boolean {
  if (insideBounds(a, bounds) || insideBounds(b, bounds)) return true
  const xy = (c: MarsCoordinate) => ({ x: c.longitudeEast, y: c.latitude })
  const corners = [
    { x: bounds.west, y: bounds.south },
    { x: bounds.east, y: bounds.south },
    { x: bounds.east, y: bounds.north },
    { x: bounds.west, y: bounds.north },
  ]
  return corners.some((corner, i) => segmentCrossing(xy(a), xy(b), corner, corners[(i + 1) % 4]) !== null)
}

/** The scan as the route builder takes it. */
export type MappedObstacleScan = typeof mappedObstacleScan

const LINE_KINDS = OBSTACLE_KINDS.lines.map((k) => `"${k}"`).join(', ')

/**
 * The features of several reads as one, each feature once: the boxes of a
 * route's legs overlap at its stops, so the same crater or ridged area comes
 * back in both. Two features are the same when their kind and every
 * coordinate agree. `covers` is not carried: it is each read's own.
 */
export function mergeFeatures(reads: readonly GeologicFeatures[]): GeologicFeatures {
  const coordinates = (cs: readonly MarsCoordinate[]) => cs.map((c) => `${c.latitude},${c.longitudeEast}`).join(' ')
  const once = <T>(items: readonly T[], key: (item: T) => string): T[] => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const k = key(item)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  return {
    points: once(reads.flatMap((r) => r.points), (f) => `${f.kind}|${coordinates([f.at])}`),
    lines: once(reads.flatMap((r) => r.lines), (f) => `${f.kind}|${coordinates(f.path)}`),
    areas: once(reads.flatMap((r) => r.areas), (f) => `${f.kind}|${f.rings.map(coordinates).join('/')}`),
  }
}

/**
 * What the map marks along a path of several straight stretches (a
 * searched route, turn to turn and stop to stop), in walking order, ids
 * `${idBase}-obstacle-n`: each marked line crossed; each marked crater within
 * CRATER_NEAR_KM of the path, once, where it is nearest; and marked ground
 * where the path starts on it or a stretch that begins outside first enters
 * it (a stretch that leaves and comes back in is one entry). Crossings and
 * what is inside are worked in one plane at the path's first point, which
 * is exact however long the path: the plane is linear in latitude and
 * longitude. A crater's distance is measured in a plane at the crater.
 */
export function mappedObstaclesAlongPath(
  path: readonly MarsCoordinate[],
  features: GeologicFeatures,
  idBase: string,
): Hazard[] {
  if (path.length < 2) return []
  const p = tangentPlane(path[0])
  const pts = path.map(p.project)
  const found: { at: number; kind: string; coordinate: MarsCoordinate; reason: string }[] = []

  for (const line of features.lines) {
    if (!isKind(OBSTACLE_KINDS.lines, line.kind)) continue
    const on = line.path.map(p.project)
    // A crossing at a turn touches the stretch before it and the one after: named once.
    const seen = new Set<string>()
    for (let s = 1; s < pts.length; s++) {
      for (let k = 1; k < on.length; k++) {
        const hit = segmentCrossing(pts[s - 1], pts[s], on[k - 1], on[k])
        if (hit === null) continue
        const key = `${hit.x.toFixed(4)},${hit.y.toFixed(4)}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({
          at: s - 1 + hit.t,
          kind: line.kind,
          coordinate: p.unproject(hit),
          reason: `The route crosses a line marked "${line.kind}" on ${named(line.map)}. The map draws where it runs, not how high or steep it is`,
        })
      }
    }
  }

  for (const crater of features.points) {
    if (!isKind(OBSTACLE_KINDS.points, crater.kind)) continue
    // Its own plane: far from the path's start the first plane's east–west scale is off.
    const local = tangentPlane(crater.at)
    const c = local.project(crater.at)
    const around = path.map(local.project)
    let best: { at: number; km: number } | null = null
    for (let s = 1; s < around.length; s++) {
      const near = nearestOnLeg(c, around[s - 1], around[s])
      if (best === null || near.km < best.km) best = { at: s - 1 + near.t, km: near.km }
    }
    if (best === null || best.km > CRATER_NEAR_KM) continue
    found.push({
      at: best.at,
      kind: crater.kind,
      coordinate: crater.at,
      reason: `A point marked "${crater.kind}" on ${named(crater.map)} lies about ${Math.round(best.km * 1000)} m from the route, inside the ${CRATER_NEAR_KM * 1000} m checked (a project choice, not a cited figure). The map marks where it is, not how wide or deep`,
    })
  }

  for (const area of features.areas) {
    if (!isKind(OBSTACLE_KINDS.areas, area.kind)) continue
    const rings = area.rings.map((ring) => ring.map(p.project))
    const reason = `The route runs over ground marked "${area.kind}" on ${named(area.map)}, from this point. The map marks where it is, not how rough`
    let inside = insideRings(pts[0], rings)
    if (inside) found.push({ at: 0, kind: area.kind, coordinate: path[0], reason })
    for (let s = 1; s < pts.length; s++) {
      if (!inside) {
        const entry = firstInside(pts[s - 1], pts[s], rings)
        if (entry !== null) found.push({ at: s - 1 + entry.t, kind: area.kind, coordinate: p.unproject(entry), reason })
      }
      inside = insideRings(pts[s], rings)
    }
  }

  return found
    .sort((u, v) => u.at - v.at)
    .map(
      (f, n): Hazard => ({
        id: `${idBase}-obstacle-${n + 1}`,
        kind: 'mapped-obstacle',
        unit: f.kind,
        coordinate: f.coordinate,
        magnitude: unavailable(f.reason),
      }),
    )
}

const POINT_KINDS = OBSTACLE_KINDS.points.map((k) => `"${k}"`).join(', ')
const AREA_KINDS = OBSTACLE_KINDS.areas.map((k) => `"${k}"`).join(', ')

/**
 * The mapped-obstacle scan of one searched route: what the geologic map
 * marks along its path, from the features each leg's search read. The
 * search keeps the path off the marked lines, so what is left to find is a
 * line crossed on the level join to a stop, a marked crater beside the path
 * and marked ground run over, none of which the search avoids.
 *
 * Legs read one after another are scanned as one path with their features
 * merged, so a crater beside a stop, or ground the route is still on at a
 * stop, is named once. A leg whose map was not read, or whose path lies
 * wholly or partly off the map's sheet, is a gap: `gaps` names each, and the
 * route then says the kind was scanned in part. With no leg read on mapped
 * ground the scan is UNAVAILABLE, never "none found".
 */
export function mappedObstacleScan(
  strategy: RouteStrategy,
  legs: readonly SearchedLeg[],
  numbers: readonly number[],
): { detector: HazardDetector; gaps: string[] } {
  const gaps: string[] = []
  const unread: string[] = []
  // Each run of legs read one after another: its path, stop to stop, and what was read along it.
  const runs: { path: MarsCoordinate[]; reads: GeologicFeatures[] }[] = []
  let open: (typeof runs)[number] | null = null
  legs.forEach((leg, l) => {
    if (!leg.obstacles.checked) {
      unread.push(`leg ${numbers[l]}: ${leg.obstacles.reason}`)
      open = null
      return
    }
    const { features } = leg.obstacles
    const nodes = leg.nodes.map((node) => node.coordinate)
    const sheet = features.covers
    if (sheet && !nodes.some((c, n) => n > 0 && stretchMeetsBounds(nodes[n - 1], c, sheet))) {
      // The leg's box touches the sheet but no stretch of its path does: none of it is on mapped ground, as if unread.
      unread.push(`leg ${numbers[l]}: it lies outside the map's sheet, where nothing is mapped`)
      open = null
      return
    }
    if (sheet && nodes.some((c) => !insideBounds(c, sheet))) {
      gaps.push(`leg ${numbers[l]}: part of it lies outside the map's sheet, where nothing is mapped`)
    }
    if (open === null) {
      open = { path: [], reads: [] }
      runs.push(open)
    }
    // The stop the previous leg ended on is this one's first node.
    open.path.push(...(open.path.length > 0 ? nodes.slice(1) : nodes))
    open.reads.push(features)
  })
  gaps.unshift(...unread)

  const detector: HazardDetector = {
    kind: 'mapped-obstacle',
    requires: ['The geologic map\'s points, lines and areas along the path, read by the route search'],
    ready: true,
    detect() {
      if (runs.length === 0) return unavailable(`The geologic map was not read along the route (${unread.join('; ')})`)
      // The same feature beside two runs (a crater by a stop either side of an unread leg) is still one hazard.
      const seen = new Set<string>()
      const found = runs
        .flatMap((run) => mappedObstaclesAlongPath(run.path, mergeFeatures(run.reads), strategy))
        .filter((h) => {
          const key = `${h.unit}|${h.coordinate.latitude},${h.coordinate.longitudeEast}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((h, n) => ({ ...h, id: `${strategy}-obstacle-${n + 1}` }))
      const notChecked = gaps.length === 0 ? '' : ` Not checked: ${gaps.join('; ')}`
      return derived(
        found,
        `What the geologic map marks along the path: lines marked ${LINE_KINDS} crossed, points marked ${POINT_KINDS} within ${CRATER_NEAR_KM * 1000} m of the path (a project choice, not a cited figure) and ground marked ${AREA_KINDS} run over. The map says where these are, not how high, wide or rough.${notChecked}`,
      )
    },
  }
  return { detector, gaps }
}
