import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import { coordinateToLocalPoint } from './projection'
import type { TileBounds } from './tilePyramid'

/** Segments per tile edge: enough that a 1.4° tile at the floor and a 22° tile high up both hug the sphere. */
const SEGMENTS = 8

/**
 * A curved patch of the globe covering `bounds`, in mesh-local space at
 * `radius`, with outward normals for lighting. UVs run u 0→1
 * west→east and v 0→1 north→south, which is the tile image's own
 * orientation, so the texture is used with flipY = false. The caller
 * disposes the geometry.
 */
export function buildTilePatch(bounds: TileBounds, radius: number): BufferGeometry {
  const n = SEGMENTS + 1
  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  const uvs = new Float32Array(n * n * 2)
  const p = new Vector3()
  for (let j = 0; j < n; j++) {
    const v = j / SEGMENTS
    const latitude = bounds.north - v * (bounds.north - bounds.south)
    for (let i = 0; i < n; i++) {
      const u = i / SEGMENTS
      const longitudeEast = (bounds.west + u * bounds.width) % 360
      coordinateToLocalPoint({ latitude, longitudeEast }, radius, p)
      const k = j * n + i
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z
      // On a sphere about the origin the exact normal is the direction of
      // the point itself; the lit tile material needs it.
      normals[k * 3] = p.x / radius
      normals[k * 3 + 1] = p.y / radius
      normals[k * 3 + 2] = p.z / radius
      uvs[k * 2] = u
      uvs[k * 2 + 1] = v
    }
  }
  const index = new Uint16Array(SEGMENTS * SEGMENTS * 6)
  let q = 0
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      // Counter-clockwise seen from outside the globe.
      index[q++] = a
      index[q++] = c
      index[q++] = b
      index[q++] = b
      index[q++] = c
      index[q++] = d
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(index, 1))
  return geometry
}
