import { validateCoordinate, type MarsCoordinate } from '../../domain'
import { surfaceDistanceKm } from './routeDistance'

/** The Terrain Profile 3D tool is defined by exactly this many corners. */
export const TERRAIN_PROFILE_CORNERS = 4

export type TerrainProfileCorners = readonly [
  MarsCoordinate,
  MarsCoordinate,
  MarsCoordinate,
  MarsCoordinate,
]

/**
 * What the 3D layer renders: the surface region bounded by four corners,
 * in the order they were set (clicked); each edge is the great-circle
 * arc to the next corner, and the last corner joins the first.
 */
export interface TerrainProfileRequest {
  corners: TerrainProfileCorners
}

/**
 * The tool's state for the corners set so far. `disabled` is the normal state
 * while corners are still being placed; `invalid` means four were placed but
 * they do not bound a region.
 */
export type TerrainProfileState =
  | { status: 'disabled'; reason: string; cornersNeeded: number }
  | { status: 'invalid'; reason: string }
  | { status: 'ready'; request: TerrainProfileRequest }

/** Why the tool is not ready. Exported so the UI can tell the cases apart. */
export const TERRAIN_PROFILE_REASONS = {
  needsCorners: 'Click the surface at the four corners of the region to build a terrain profile',
  tooManyCorners: 'A terrain profile takes exactly four corners; remove the extra ones',
  invalidCoordinate: 'A corner has an invalid coordinate',
  duplicate: 'Two corners are at the same point',
  tooSpread:
    'The corners are spread over too much of the globe to enclose one unambiguous region',
  collinear:
    'Three corners in a row lie on one great circle, so the shape has fewer than four corners',
  selfIntersecting: 'Two edges cross; click the corners in order around the region',
} as const

/** Corners closer than this (1 µm) are the same point, as in elevationProfile. */
const SAME_POINT_KM = 1e-9

/**
 * A corner whose two edges meet at less than this angle (sine, about
 * 0.00000006°) is a straight line through it: float error, not a corner.
 */
const COLLINEAR_SINE = 1e-9

type Vec3 = readonly [number, number, number]

const toRadians = (deg: number) => (deg * Math.PI) / 180

function unitVector(c: MarsCoordinate): Vec3 {
  const lat = toRadians(c.latitude)
  const lon = toRadians(c.longitudeEast)
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const length = (a: Vec3) => Math.sqrt(dot(a, a))

/**
 * Which way the path a → b → c turns at b: +1 left, −1 right, 0 straight
 * (all three on one great circle). Uses the edge vectors from b rather than
 * the unit vectors themselves, so corners metres apart are not lost to float
 * error; det(a, b, c) = det(a − b, b, c − b).
 */
function turn(a: Vec3, b: Vec3, c: Vec3): -1 | 0 | 1 {
  const toA = sub(a, b)
  const toC = sub(c, b)
  const det = dot(toA, cross(b, toC))
  const sine = det / (length(cross(toA, b)) * length(cross(b, toC)))
  if (Math.abs(sine) < COLLINEAR_SINE) return 0
  return sine > 0 ? 1 : -1
}

/**
 * The Terrain Profile 3D tool's state for the corners set so far, in order.
 *
 * Fewer than four corners is `disabled`; four that do not bound a region are
 * `invalid`, with the first problem found. A valid region may be convex or
 * concave and wound either way. Only the geometry is checked here; terrain
 * sampling inside the region waits for an elevation dataset (after
 * 2026-10-28), and rendering is mars-3d's.
 */
export function terrainProfileState(points: readonly MarsCoordinate[]): TerrainProfileState {
  if (points.length < TERRAIN_PROFILE_CORNERS) {
    return {
      status: 'disabled',
      reason: TERRAIN_PROFILE_REASONS.needsCorners,
      cornersNeeded: TERRAIN_PROFILE_CORNERS - points.length,
    }
  }
  if (points.length > TERRAIN_PROFILE_CORNERS) {
    return { status: 'invalid', reason: TERRAIN_PROFILE_REASONS.tooManyCorners }
  }
  const corners: TerrainProfileCorners = [points[0], points[1], points[2], points[3]]

  if (!corners.every((c) => validateCoordinate(c).ok)) {
    return { status: 'invalid', reason: TERRAIN_PROFILE_REASONS.invalidCoordinate }
  }

  // Every pair, not just neighbours: a repeated diagonal also leaves three corners.
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      if (surfaceDistanceKm(corners[i], corners[j]) < SAME_POINT_KM) {
        return { status: 'invalid', reason: TERRAIN_PROFILE_REASONS.duplicate }
      }
    }
  }

  // Every corner within 90° of the corners' mean direction. Then the whole
  // shape lies in one hemisphere, "inside" is unambiguous, and the turn signs
  // below classify it exactly as they would on a plane.
  const v = corners.map(unitVector)
  const mean = v.reduce<Vec3>((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0])
  if (!v.every((p) => dot(p, mean) > 0)) {
    return { status: 'invalid', reason: TERRAIN_PROFILE_REASONS.tooSpread }
  }

  const turns = v.map((p, i) => turn(v[(i + 3) % 4], p, v[(i + 1) % 4]))
  if (turns.includes(0)) {
    return { status: 'invalid', reason: TERRAIN_PROFILE_REASONS.collinear }
  }
  // A quadrilateral turning the same way at all four corners is convex, at
  // three of four concave; two and two is a bow tie, whose edges cross.
  const left = turns.filter((t) => t === 1).length
  if (left === 2) {
    return { status: 'invalid', reason: TERRAIN_PROFILE_REASONS.selfIntersecting }
  }

  return { status: 'ready', request: { corners } }
}
