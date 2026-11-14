import { ShapeUtils, Vector2, Vector3 } from 'three'
import type { GeologicUnitArea } from '../../domain'
import { openRing, unwrappedLongitudes } from './geologyArea'
import { coordinateToLocalPoint } from './projection'

/**
 * Pure geometry for the geology layer, kept out of the component so
 * it can be tested without a renderer. Positions are in the globe mesh's
 * local space, through the same convention as every other surface point.
 *
 * Nothing here changes what the map says: rings are triangulated and
 * outlined as given. Which unit covers a point is geologyArea's, which
 * needs no renderer.
 */

/**
 * Triangulated fill for one area: vertex positions (x, y, z per vertex) on
 * the sphere of `radius`, and triangle indices into them. Triangulated in
 * the (longitude, latitude) plane, which is near enough to the surface for
 * a site-sized polygon. An area whose outer ring has fewer than three
 * vertices yields nothing.
 */
export function areaFill(
  area: GeologicUnitArea,
  radius: number,
): { positions: Float32Array; indices: Uint32Array } {
  const rings = area.rings.map(openRing)
  const outer = rings[0]
  if (!outer || outer.length < 3) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) }
  }
  const reference = outer[0].longitudeEast
  const flat = rings.filter((r) => r.length >= 3)
  const planar = flat.map((ring) => {
    const lons = unwrappedLongitudes(ring, reference)
    return ring.map((c, i) => new Vector2(lons[i], c.latitude))
  })
  const triangles = ShapeUtils.triangulateShape(planar[0], planar.slice(1))

  const positions = new Float32Array(flat.reduce((n, r) => n + r.length, 0) * 3)
  const p = new Vector3()
  let k = 0
  for (const ring of flat) {
    for (const c of ring) {
      coordinateToLocalPoint(c, radius, p)
      positions[k++] = p.x
      positions[k++] = p.y
      positions[k++] = p.z
    }
  }
  return { positions, indices: Uint32Array.from(triangles.flat()) }
}

/**
 * Line-segment vertex pairs (x, y, z per vertex) outlining every ring of
 * an area, each ring closed back to its first vertex. For a LineSegments.
 */
export function areaOutline(area: GeologicUnitArea, radius: number): Float32Array {
  const out: number[] = []
  const a = new Vector3()
  const b = new Vector3()
  for (const raw of area.rings) {
    const ring = openRing(raw)
    if (ring.length < 2) continue
    for (let i = 0; i < ring.length; i++) {
      coordinateToLocalPoint(ring[i], radius, a)
      coordinateToLocalPoint(ring[(i + 1) % ring.length], radius, b)
      out.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }
  return new Float32Array(out)
}

/**
 * Every area's fill merged into one indexed geometry, with an RGB colour
 * per vertex from `colorOf`, and every outline into one segment list, so
 * the whole layer is two draw calls however many units the map has.
 */
export function mergeAreas(
  areas: readonly GeologicUnitArea[],
  radius: number,
  colorOf: (area: GeologicUnitArea) => { r: number; g: number; b: number },
): { positions: Float32Array; colors: Float32Array; indices: Uint32Array; outline: Float32Array } {
  const fills = areas.map((a) => areaFill(a, radius))
  const outlines = areas.map((a) => areaOutline(a, radius))
  const vertexCount = fills.reduce((n, f) => n + f.positions.length / 3, 0)
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(fills.reduce((n, f) => n + f.indices.length, 0))
  const outline = new Float32Array(outlines.reduce((n, o) => n + o.length, 0))

  let vertex = 0
  let index = 0
  for (let i = 0; i < areas.length; i++) {
    const { positions: p, indices: t } = fills[i]
    const { r, g, b } = colorOf(areas[i])
    positions.set(p, vertex * 3)
    for (let v = 0; v < p.length / 3; v++) {
      colors[(vertex + v) * 3] = r
      colors[(vertex + v) * 3 + 1] = g
      colors[(vertex + v) * 3 + 2] = b
    }
    for (let k = 0; k < t.length; k++) indices[index + k] = t[k] + vertex
    vertex += p.length / 3
    index += t.length
  }
  let at = 0
  for (const o of outlines) {
    outline.set(o, at)
    at += o.length
  }
  return { positions, colors, indices, outline }
}
