import { Vector3 } from 'three'
import type { MarsCoordinate } from '../../domain'
import { TERRAIN_PROFILE_3D_TOOL_ID, TERRAIN_PROFILE_TOOL_ID } from '../../state'
import { coordinateToLocalPoint } from './projection'

/**
 * The Terrain Profile 3D region on the globe: the filled sector
 * between three or four corners, as triangles on the sphere, and what to
 * draw at each click count. Pure and tested; `TerrainRegion` draws it.
 */

/** Subdivisions along a triangle's longest edge are about this many degrees apart, so the fill hugs the sphere. */
const STEP_DEG = 0.5
/** At most this many subdivisions a side (a whole-hemisphere region is still a few thousand triangles). */
const MAX_STEPS = 24

/**
 * Which diagonal of a four-corner region lies inside it: `[0, 2]` or
 * `[1, 3]`. For a simple quadrilateral the diagonal whose two other
 * corners fall on opposite sides of it is the interior one, convex or
 * concave; a bow tie has no interior diagonal and gets `[0, 2]`. Decided
 * in the tangent plane at the corners' mean direction.
 */
export function interiorDiagonal(corners: readonly MarsCoordinate[]): readonly [number, number] {
  const v = corners.map((c) => coordinateToLocalPoint(c, 1))
  const centre = v.reduce((sum, p) => sum.add(p), new Vector3()).normalize()
  // East is the pole axis crossed with the centre; at a pole that is zero, so any axis across the centre serves.
  const up = Math.abs(centre.y) > 0.999 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  const east = up.cross(centre).normalize()
  const north = centre.clone().cross(east).normalize()
  const flat = v.map((p) => ({ x: p.dot(east), y: p.dot(north) }))
  const side = (a: number, b: number, c: number) =>
    Math.sign((flat[b].x - flat[a].x) * (flat[c].y - flat[a].y) - (flat[b].y - flat[a].y) * (flat[c].x - flat[a].x))
  return side(0, 2, 1) * side(0, 2, 3) < 0 ? [0, 2] : [1, 3]
}

/**
 * The region's fill as triangle vertices (xyz per vertex, three vertices
 * per triangle) at `radius`, globe-local. Three corners are one spherical
 * triangle; four are two, split along the interior diagonal. Each triangle
 * is subdivided into a lattice whose vertices are pushed onto the sphere,
 * so the fill never sinks below the surface. Fewer than three corners draw
 * nothing.
 */
export function regionTriangles(corners: readonly MarsCoordinate[], radius: number): Float32Array {
  if (corners.length < 3) return new Float32Array(0)
  const v = corners.map((c) => coordinateToLocalPoint(c, 1))
  const triangles: [Vector3, Vector3, Vector3][] =
    corners.length === 3
      ? [[v[0], v[1], v[2]]]
      : (() => {
          const [i, j] = interiorDiagonal(corners)
          const others = [0, 1, 2, 3].filter((k) => k !== i && k !== j)
          return [
            [v[i], v[others[0]], v[j]],
            [v[i], v[j], v[others[1]]],
          ]
        })()
  const out: number[] = []
  const p = new Vector3()
  for (const [a, b, c] of triangles) {
    const longest = Math.max(a.angleTo(b), b.angleTo(c), c.angleTo(a)) * (180 / Math.PI)
    const n = Math.min(MAX_STEPS, Math.max(1, Math.ceil(longest / STEP_DEG)))
    const at = (i: number, j: number): [number, number, number] => {
      p.set(0, 0, 0)
        .addScaledVector(a, n - i - j)
        .addScaledVector(b, i)
        .addScaledVector(c, j)
        .normalize()
        .multiplyScalar(radius)
      return [p.x, p.y, p.z]
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        out.push(...at(i, j), ...at(i + 1, j), ...at(i, j + 1))
        if (i + j < n - 1) out.push(...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j + 1))
      }
    }
  }
  return Float32Array.from(out)
}

/**
 * What to draw for the active tool: the outline's vertices and the region's
 * corners, or none. While a point is being changed (`replacing`, its
 * index) the cursor stands in for it, so the line or region previews the
 * move.
 */
export function regionShapes(
  tool: string | null,
  set: readonly MarsCoordinate[],
  hover: MarsCoordinate | null,
  replacing: number | null = null,
): { outline: readonly MarsCoordinate[]; region: readonly MarsCoordinate[] | null } {
  const moving = replacing !== null && replacing < set.length
  const cursor = hover
  const points = moving && cursor ? set.map((p, i) => (i === replacing ? cursor : p)) : set
  // A moved point is the cursor already; it is not also the next one.
  const next = moving ? null : hover
  if (tool === TERRAIN_PROFILE_TOOL_ID) {
    return { outline: points.length === 2 ? points : points.length === 1 && next ? [points[0], next] : [], region: null }
  }
  if (tool !== TERRAIN_PROFILE_3D_TOOL_ID || points.length === 0) return { outline: [], region: null }
  if (points.length >= 4) {
    const corners = points.slice(0, 4)
    return { outline: [...corners, corners[0]], region: corners }
  }
  const live = next ? [...points, next] : points
  return { outline: live.length >= 2 ? (live.length === 4 ? [...live, live[0]] : live) : [], region: live.length === 4 ? live : null }
}
