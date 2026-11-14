import type { MarsCoordinate } from '../../../domain'
import { sampleHeight, type Heightfield } from './heightfield'
import { toPatch, type PatchFrame } from './surfacePatch'

/**
 * A line on the surface view's ground: each path's vertices placed
 * in the patch's metres and dropped onto the drawn heights, with extra
 * points every `stepM` so the line follows the terrain between vertices
 * instead of cutting through a hill. Only the parts over this patch are
 * kept; the rest appears when the walker's patch moves there.
 *
 * Returns vertex pairs for a LineSegments, in the ground's world space:
 * x east, y up (height + `liftM`), z south. Pure; tested with a fixture field.
 */
export function drapedSegments(
  paths: readonly (readonly MarsCoordinate[])[],
  frame: PatchFrame,
  field: Heightfield,
  stepM: number,
  liftM: number,
): Float32Array {
  const halfM = ((field.size - 1) * field.spacingM) / 2
  const inside = (x: number, y: number) => Math.abs(x) <= halfM && Math.abs(y) <= halfM
  const out: number[] = []
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = toPatch(frame, path[i - 1])
      const b = toPatch(frame, path[i])
      const ax = a.xKm * 1000
      const ay = a.yKm * 1000
      const bx = b.xKm * 1000
      const by = b.yKm * 1000
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepM))
      let px = ax
      let py = ay
      for (let s = 1; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps
        const y = ay + ((by - ay) * s) / steps
        if (inside(px, py) && inside(x, y)) {
          out.push(px, sampleHeight(field, px, py) + liftM, -py, x, sampleHeight(field, x, y) + liftM, -y)
        }
        px = x
        py = y
      }
    }
  }
  return new Float32Array(out)
}
