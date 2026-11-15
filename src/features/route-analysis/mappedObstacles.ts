import {
  HAZARD_NOT_CHECKED,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type GeologicMap,
  type Hazard,
  type MarsCoordinate,
} from '../../domain'
import { insideRings, tangentPlane, type Xy } from './scienceGoals'

/**
 * What a geologic map marks along a walk leg: the lines it crosses,
 * the small craters beside it and the ridged ground it runs over. Each is
 * named in the map's own wording and cites the map. The map says where these
 * are, not how high or wide, so a hazard's magnitude is UNAVAILABLE with that
 * said. Worked in a plane at the leg's start, fine for legs of a few km.
 */

/**
 * The kinds treated as obstacles, spelled as SIM 3464 spells them (`TYPE`
 * values of layers 4, 6 and 7, read from the service 2026-11-01). Left out on
 * purpose: "channel (fluvial)", "lineament", "crest of buried crater" and
 * "dark-colored mantling material". That is this project's judgement of what
 * stands in a walker's way, not something the map says.
 */
export const OBSTACLE_KINDS = {
  points: ['small crater'],
  lines: ['ridge crest (type 1), certain', 'crest of crater rim', 'delta lobe front'],
  areas: ['ridged'],
} as const

/** How near the leg a marked crater is flagged, km. A project choice, not a cited figure. */
export const CRATER_NEAR_KM = 0.1

export const isKind = (kinds: readonly string[], kind: string) => kinds.includes(kind)
export const named = (map: GeologicMap) => `${map.id} (${map.citation})`

/** The leg's mapped obstacles in walking order, ids `${idBase}-obstacle-n`. */
export function mappedObstacleHazards(
  from: MarsCoordinate,
  to: MarsCoordinate,
  features: Classified<GeologicFeatures>,
  idBase: string,
): Hazard[] {
  if (features.classification === 'UNAVAILABLE') {
    // The same as a stretch with no height: said on the leg, so an unread map never reads as a clear one.
    return [
      {
        id: `${idBase}-obstacle-1`,
        kind: 'mapped-obstacle',
        unit: HAZARD_NOT_CHECKED,
        coordinate: from,
        magnitude: unavailable(`Mapped obstacles were not checked: ${features.reason}`),
      },
    ]
  }

  const p = tangentPlane(from)
  const a = p.project(from)
  const b = p.project(to)
  const found: { t: number; kind: string; coordinate: MarsCoordinate; reason: string }[] = []

  for (const line of features.value.lines) {
    if (!isKind(OBSTACLE_KINDS.lines, line.kind)) continue
    const pts = line.path.map(p.project)
    for (let k = 1; k < pts.length; k++) {
      const hit = segmentCrossing(a, b, pts[k - 1], pts[k])
      if (hit === null) continue
      found.push({
        t: hit.t,
        kind: line.kind,
        coordinate: p.unproject(hit),
        reason: `The leg crosses a line marked "${line.kind}" on ${named(line.map)}. The map draws where it runs, not how high or steep it is`,
      })
    }
  }

  for (const crater of features.value.points) {
    if (!isKind(OBSTACLE_KINDS.points, crater.kind)) continue
    const near = nearestOnLeg(p.project(crater.at), a, b)
    if (near.km > CRATER_NEAR_KM) continue
    found.push({
      t: near.t,
      kind: crater.kind,
      coordinate: crater.at,
      reason: `A point marked "${crater.kind}" on ${named(crater.map)} lies about ${Math.round(near.km * 1000)} m from the leg, inside the ${CRATER_NEAR_KM * 1000} m checked (a project choice, not a cited figure). The map marks where it is, not how wide or deep`,
    })
  }

  for (const area of features.value.areas) {
    if (!isKind(OBSTACLE_KINDS.areas, area.kind)) continue
    const rings = area.rings.map((ring) => ring.map(p.project))
    const entry = firstInside(a, b, rings)
    if (entry === null) continue
    found.push({
      t: entry.t,
      kind: area.kind,
      coordinate: p.unproject(entry),
      reason: `The leg runs over ground marked "${area.kind}" on ${named(area.map)}, from this point. The map marks where it is, not how rough`,
    })
  }

  return found
    .sort((u, v) => u.t - v.t)
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

/** Where segment ab meets segment cd, with `t` the fraction along ab; null when they do not meet. Touching counts. */
export function segmentCrossing(a: Xy, b: Xy, c: Xy, d: Xy): (Xy & { t: number }) | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const denom = rx * sy - ry * sx
  if (denom === 0) return null // parallel or collinear: running along a line is not crossing it
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a.x + t * rx, y: a.y + t * ry, t }
}

/** The fraction along ab nearest `c`, and how far `c` is from it. */
export function nearestOnLeg(c: Xy, a: Xy, b: Xy): { t: number; km: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2))
  return { t, km: Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y) }
}

/** The first point of ab inside the polygon: a itself, or where ab first crosses an edge. Null when it stays outside. */
export function firstInside(a: Xy, b: Xy, rings: readonly Xy[][]): (Xy & { t: number }) | null {
  if (insideRings(a, rings)) return { ...a, t: 0 }
  let first: (Xy & { t: number }) | null = null
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const hit = segmentCrossing(a, b, ring[j], ring[i])
      if (hit !== null && (first === null || hit.t < first.t)) first = hit
    }
  }
  return first
}
